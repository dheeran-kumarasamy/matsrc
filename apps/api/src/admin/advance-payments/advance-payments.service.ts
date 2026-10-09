import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { appendLedgerEntry, lockAdvanceAccountRow } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationService } from "src/notifications/notification.service";

// Admin review/approval/rejection of manual Buildohub Advance Payments.
// Mirrors apps/api/src/admin/payments/payments.service.ts's
// find/approve/reject pattern exactly (same idempotency guarantees, same
// atomic-transaction + audit-log + notification shape) — the advance ledger
// CREDIT is the ONLY thing that may ever increase a buyer's available
// balance (see appendLedgerEntry doc comment in packages/db/lib/advance-ledger.ts).
@Injectable()
export class AdvancePaymentsService {
  private readonly logger = new Logger(AdvancePaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService
  ) {}

  async findAll(status?: "PENDING" | "APPROVED" | "REJECTED") {
    const payments = await this.prisma.advancePayment.findMany({
      where: status ? { status } : undefined,
      include: {
        buyer: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { submittedAt: "desc" },
    });

    return payments.map((p) => this.serializeSummary(p));
  }

  async findOne(id: string) {
    const payment = await this.prisma.advancePayment.findUnique({
      where: { id },
      include: { buyer: { select: { id: true, name: true, email: true, phone: true } } },
    });
    if (!payment) {
      throw new NotFoundException("Advance payment not found");
    }
    return this.serializeSummary(payment);
  }

  // Streams the raw screenshot bytes to an authorized admin only — same
  // pattern as PaymentsService.getScreenshot.
  async getScreenshot(id: string) {
    const payment = await this.prisma.advancePayment.findUnique({
      where: { id },
      select: { screenshotData: true, screenshotMimeType: true, screenshotFileName: true },
    });
    if (!payment || !payment.screenshotData) {
      throw new NotFoundException("No advance-payment screenshot found");
    }
    return payment as { screenshotData: Buffer; screenshotMimeType: string; screenshotFileName: string };
  }

  // Approval is a financial operation and must be atomic (spec §16):
  // 1. Re-check status is still PENDING inside the transaction (idempotent
  //    no-op if already APPROVED — never re-triggers a second credit).
  // 2. Lock the CustomerAdvanceAccount row (SELECT ... FOR UPDATE).
  // 3. Append an immutable CREDIT ledger entry + update cached balance.
  // 4. Mark the AdvancePayment APPROVED, recording approver + timestamp.
  // 5. Audit log + buyer notification (best-effort, never blocks approval).
  async approve(id: string, actorId: string) {
    const payment = await this.prisma.advancePayment.findUnique({
      where: { id },
      include: { buyer: true },
    });
    if (!payment) {
      throw new NotFoundException("Advance payment not found");
    }

    if (payment.status === "APPROVED") {
      // Already approved — idempotent no-op (spec: "Payment approved twice"
      // must never happen).
      return this.serializeSummary(payment);
    }
    if (payment.status !== "PENDING") {
      throw new BadRequestException("Only a payment awaiting verification can be approved");
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      // Re-read + lock inside the transaction to defend against a
      // concurrent duplicate-approval request racing this one.
      const current = await tx.advancePayment.findUnique({ where: { id } });
      if (!current || current.status === "APPROVED") {
        return current;
      }
      if (current.status !== "PENDING") {
        throw new BadRequestException("Only a payment awaiting verification can be approved");
      }

      const locked = await lockAdvanceAccountRow(tx as any, payment.advanceAccountId);
      const currentAvailable = Number(locked.availableBalance);
      const currentReserved = Number(locked.reservedBalance);

      const { transaction, availableAfter: balanceAfter } = await appendLedgerEntry(tx as any, {
        accountId: payment.advanceAccountId,
        type: "CREDIT",
        amount: Number(payment.amount),
        currentAvailable,
        currentReserved,
        reference: payment.referenceNumber,
        paymentMethod: payment.paymentMethod,
        advancePaymentId: payment.id,
        createdBy: actorId,
        approvedBy: actorId,
        approvedAt: now,
      });

      const approvedPayment = await tx.advancePayment.update({
        where: { id },
        data: { status: "APPROVED", approvedAt: now, approvedBy: actorId, rejectedAt: null, rejectedBy: null, rejectionReason: null },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "ADVANCE_PAYMENT_APPROVED",
          entityType: "AdvancePayment",
          entityId: payment.id,
          metadata: { amount: Number(payment.amount), balanceAfter, ledgerTransactionId: transaction.id },
        },
      });

      return approvedPayment;
    });

    const recipient = payment.buyer.phone?.trim();
    if (recipient) {
      void this.notificationService
        .sendWhatsApp({
          to: recipient,
          title: "Advance payment approved",
          body: `₹${Number(payment.amount).toLocaleString("en-IN")} has been added to your Buildohub Advance Balance. Reference: ${payment.referenceNumber}`,
          idempotencyKey: `advance-payment-approved:${payment.id}`,
        })
        .catch(() => undefined);
    }

    return this.serializeSummary({ ...updated, buyer: payment.buyer } as any);
  }

  // Rejection (spec §17): status = REJECTED, store rejectedBy/rejectedAt/
  // rejectionReason, NEVER creates a ledger CREDIT, NEVER increases the
  // balance. Idempotent: rejecting an already-REJECTED payment again just
  // updates the reason/timestamp.
  async reject(id: string, actorId: string, reason: string) {
    const payment = await this.prisma.advancePayment.findUnique({
      where: { id },
      include: { buyer: true },
    });
    if (!payment) {
      throw new NotFoundException("Advance payment not found");
    }
    if (payment.status === "APPROVED") {
      throw new BadRequestException("An already-approved advance payment cannot be rejected");
    }

    const now = new Date();
    const wasAlreadyRejected = payment.status === "REJECTED";

    const [updated] = await this.prisma.$transaction([
      this.prisma.advancePayment.update({
        where: { id },
        data: { status: "REJECTED", rejectedAt: now, rejectedBy: actorId, rejectionReason: reason },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: "ADVANCE_PAYMENT_REJECTED",
          entityType: "AdvancePayment",
          entityId: payment.id,
          metadata: { reason },
        },
      }),
    ]);

    if (!wasAlreadyRejected) {
      const recipient = payment.buyer.phone?.trim();
      if (recipient) {
        void this.notificationService
          .sendWhatsApp({
            to: recipient,
            title: "Advance payment rejected",
            body: `Your advance payment ${payment.referenceNumber} could not be approved. Reason: ${reason}`,
            idempotencyKey: `advance-payment-rejected:${payment.id}:${now.getTime()}`,
          })
          .catch(() => undefined);
      }
    }

    return this.serializeSummary({ ...updated, buyer: payment.buyer } as any);
  }

  private serializeSummary(p: any) {
    return {
      id: p.id,
      referenceNumber: p.referenceNumber,
      buyer: p.buyer ? { id: p.buyer.id, name: p.buyer.name, email: p.buyer.email, phone: p.buyer.phone } : null,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      paymentReference: p.paymentReference,
      status: p.status,
      submittedAt: p.submittedAt,
      approvedAt: p.approvedAt,
      approvedBy: p.approvedBy,
      rejectedAt: p.rejectedAt,
      rejectedBy: p.rejectedBy,
      rejectionReason: p.rejectionReason,
      screenshotFileName: p.screenshotFileName,
      // Consumed by apps/admin's own proxy route (mirrors the existing
      // order-payment screenshot pattern) — never a public/static URL.
      screenshotUrl: `/api/admin/advance-payments/${p.id}/screenshot`,
    };
  }
}
