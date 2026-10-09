import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import {
  OrderStatus,
  PaymentStatus,
  PaymentVerificationStatus,
  generateOrderNumber,
  lockAdvanceAccountRow,
  consumeAdvanceReservation,
  releaseAdvanceReservation,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationService } from "src/notifications/notification.service";
import { CustomerOrderStatusNotificationService } from "src/notification-engine/whatsapp/customer-order-status-notification.service";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly customerOrderStatusNotificationService: CustomerOrderStatusNotificationService
  ) {}

  // List every order whose bank-transfer payment proof is currently
  // PENDING admin review, for the admin payments queue.
  async findPendingVerifications() {
    const verifications = await this.prisma.paymentVerification.findMany({
      where: { status: PaymentVerificationStatus.PENDING },
      include: {
        order: {
          select: {
            id: true,
            enquiryId: true,
            status: true,
            totalAmount: true,
            paymentMethod: true,
            // Admin visibility (spec §33): lets the review screen answer
            // "Advance Reserved: X / Advance Status: ACTIVE" alongside the
            // external payment it's reviewing.
            advanceReservation: { select: { amount: true, status: true } },
          },
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { submittedAt: "asc" },
    });

    return verifications.map((v) => this.serializeSummary(v as any));
  }

  // List every order whose bank-transfer payment proof has been APPROVED —
  // i.e. every order that has satisfied the payment-verification
  // prerequisite for invoice generation (see
  // src/admin/invoices/invoices.service.ts's checkEligibility). Surfaced on
  // the same Admin payments page as the pending queue above so the Admin
  // has a single place to go from "verify payment" -> "generate invoice"
  // for a given order (Order.invoice is included so the UI can render
  // Generate Invoice vs View/Download Invoice without a second request).
  async findApprovedWithInvoiceStatus() {
    const verifications = await this.prisma.paymentVerification.findMany({
      where: { status: PaymentVerificationStatus.APPROVED },
      include: {
        order: {
          select: {
            id: true,
            enquiryId: true,
            status: true,
            totalAmount: true,
            paymentMethod: true,
            invoice: { select: { id: true, invoiceNumber: true } },
          },
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { reviewedAt: "desc" },
    });

    return verifications.map((v) => ({
      ...this.serializeSummary(v as any),
      invoice: v.order.invoice ? { id: v.order.invoice.id, invoiceNumber: v.order.invoice.invoiceNumber } : null,
    }));
  }

  // Full detail for a single order's payment verification, for the admin
  // review screen (excludes the raw screenshot bytes — those are only ever
  // served by the dedicated screenshot route below, gated the same way).
  async findOne(orderId: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      include: {
        order: { select: { id: true, enquiryId: true, status: true, totalAmount: true, paymentMethod: true, paymentStatus: true } },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!verification) {
      throw new NotFoundException("No payment verification found for this order");
    }
    return this.serializeSummary(verification);
  }

  // Returns the raw screenshot bytes + mime type for the admin-only viewer
  // route. Authorization (ADMIN role) is already enforced by the
  // controller's guards — this only checks the record exists.
  async getScreenshot(orderId: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      select: { screenshotData: true, screenshotMimeType: true, screenshotFileName: true },
    });
    if (!verification) {
      throw new NotFoundException("No payment screenshot found for this order");
    }
    return verification;
  }

  // Approve Payment: marks the verification APPROVED, records who/when,
  // moves Order.paymentStatus to PAID, and hands off to the existing
  // supplier-processing workflow (order.status -> PROCESSING via the same
  // transition already used elsewhere, e.g. best-price selection) — never a
  // parallel/duplicate supplier-processing path. Idempotent: a second
  // approval call for an already-APPROVED payment is a no-op that returns
  // the existing state instead of re-triggering anything.
  async approve(orderId: string, actorId: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!verification) {
      throw new NotFoundException("No payment verification found for this order");
    }

    if (verification.status === PaymentVerificationStatus.APPROVED) {
      // Already approved — idempotent no-op, do not re-trigger anything.
      return this.serializeSummary({ ...verification, user: await this.getUser(verification.userId) } as any);
    }

    if (verification.status !== PaymentVerificationStatus.PENDING) {
      throw new BadRequestException("Only a payment awaiting verification can be approved");
    }

    const now = new Date();

    const updatedVerification = await this.prisma.$transaction(async (tx) => {
      const existingOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: { orderNumber: true },
      });
      let orderNumber = existingOrder?.orderNumber;
      if (!orderNumber && verification.order.status === OrderStatus.PLACED) {
        orderNumber = await generateOrderNumber(tx as any);
      }

      const ver = await tx.paymentVerification.update({
        where: { id: verification.id },
        data: {
          status: PaymentVerificationStatus.APPROVED,
          reviewedAt: now,
          reviewedBy: actorId,
          rejectionReason: null,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.PAID,
          status: verification.order.status === OrderStatus.PLACED ? OrderStatus.PROCESSING : verification.order.status,
          ...(orderNumber ? { orderNumber } : {}),
        },
      });

      await tx.orderTracking.create({
        data: {
          orderId,
          status: OrderStatus.PROCESSING,
          note: "Payment verified by admin — order confirmed for supplier processing",
        },
      });

      // Advance Balance reservation consumption (fixes the original bug:
      // advance was being permanently debited the moment the buyer applied
      // it, even while this external payment was still unconfirmed). This
      // approval IS the authoritative order-payment-confirmation event, so
      // if the buyer reserved any advance against this order, it is
      // consumed (RESERVED -> CONSUMED) atomically in the SAME transaction
      // as the order being marked PAID — never two separate commits that
      // could leave "order PAID, advance still RESERVED" or vice versa.
      // consumeAdvanceReservation is a no-op (returns null) if this order
      // never used advance, or if it was already consumed.
      const advanceAccount = await tx.customerAdvanceAccount.findFirst({
        where: { buyerId: verification.userId },
        select: { id: true },
      });
      if (advanceAccount) {
        const locked = await lockAdvanceAccountRow(tx as any, advanceAccount.id);
        await consumeAdvanceReservation(tx as any, {
          orderId,
          createdBy: actorId,
          reference: verification.order.enquiryId ?? orderId,
          currentAvailable: Number(locked.availableBalance),
          currentReserved: Number(locked.reservedBalance),
          approvedBy: actorId,
          approvedAt: now,
        });
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: "PAYMENT_VERIFICATION_APPROVED",
          entityType: "PaymentVerification",
          entityId: verification.id,
          metadata: { orderId, amount: Number(verification.amount) },
        },
      });

      return ver;
    });

    const customer = await this.getUser(verification.userId);

    // Best-effort customer notification — never blocks the approval itself.
    const recipient = customer.phone?.trim();
    if (recipient) {
      void this.notificationService
        .sendWhatsApp({
          to: recipient,
          title: "Payment approved",
          body: `Your payment for order #${verification.order.enquiryId ?? orderId} has been verified. Your order is now being processed.`,
          idempotencyKey: `payment-approved:${orderId}`,
        })
        .catch(() => undefined);
    }

    // Notification Engine — customer_order_status WhatsApp template. The
    // transaction above only actually moves status PLACED -> PROCESSING
    // (see the conditional in the `order.update` data above) — a payment
    // approval for an order already past PLACED leaves status unchanged, so
    // only notify when a real transition happened.
    const orderStatusActuallyChanged = verification.order.status === OrderStatus.PLACED;
    if (orderStatusActuallyChanged) {
      // Scheduled via Vercel's waitUntil() — apps/api runs as a Vercel
      // serverless function, so a detached `void` promise is not guaranteed
      // to finish before the instance is frozen after the HTTP response is
      // sent (see apps/supplier/lib/supplier-data.ts for the full
      // explanation of the production issue this fixes).
      waitUntil(
        this.customerOrderStatusNotificationService
          .notifyIfTransitioned({ orderId, previousStatus: verification.order.status, newStatus: OrderStatus.PROCESSING })
          .catch((error) => {
            this.logger.warn(`Failed to send customer_order_status notification for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`);
          })
      );
    }

    return this.serializeSummary({
      ...updatedVerification,
      order: { ...verification.order, status: OrderStatus.PROCESSING },
      user: customer,
    } as any);
  }

  // Reject Payment: marks the verification REJECTED with a stored reason,
  // records who/when, and resets Order.paymentStatus back to PENDING so the
  // order is NOT sent to supplier processing and the customer can resubmit
  // a new screenshot from the same payment page. Idempotent: rejecting an
  // already-REJECTED payment again just updates the reason/timestamp
  // without any duplicate order transition/notification.
  async reject(orderId: string, actorId: string, reason: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!verification) {
      throw new NotFoundException("No payment verification found for this order");
    }

    if (verification.status === PaymentVerificationStatus.APPROVED) {
      throw new BadRequestException("An already-approved payment cannot be rejected");
    }

    const now = new Date();
    const wasAlreadyRejected = verification.status === PaymentVerificationStatus.REJECTED;

    // Converted from the previous array-style $transaction([...]) to a
    // callback-style transaction so the Advance Balance reservation release
    // below (which needs to look up the buyer's account row and lock it)
    // can run atomically alongside the rejection + order reset — never two
    // separate commits that could leave "payment rejected, advance still
    // RESERVED".
    const updatedVerification = await this.prisma.$transaction(async (tx) => {
      const ver = await tx.paymentVerification.update({
        where: { id: verification.id },
        data: {
          status: PaymentVerificationStatus.REJECTED,
          reviewedAt: now,
          reviewedBy: actorId,
          rejectionReason: reason,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: PaymentStatus.PENDING },
      });

      // Release any advance balance the buyer had RESERVED against this
      // order (fixes the original bug: advance was being permanently
      // debited even when this external payment ultimately failed). A
      // rejection is a definitive "this payment did not succeed" event, so
      // any ACTIVE reservation for the order is released back to the
      // buyer's available balance — never silently left RESERVED forever.
      // No-op (returns null) if this order never used advance, or if it
      // was already released/consumed.
      const advanceAccount = await tx.customerAdvanceAccount.findFirst({
        where: { buyerId: verification.userId },
        select: { id: true },
      });
      if (advanceAccount) {
        const locked = await lockAdvanceAccountRow(tx as any, advanceAccount.id);
        await releaseAdvanceReservation(tx as any, {
          orderId,
          createdBy: actorId,
          reference: verification.order.enquiryId ?? orderId,
          currentAvailable: Number(locked.availableBalance),
          currentReserved: Number(locked.reservedBalance),
        });
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: "PAYMENT_VERIFICATION_REJECTED",
          entityType: "PaymentVerification",
          entityId: verification.id,
          metadata: { orderId, reason },
        },
      });

      return ver;
    });

    const customer = await this.getUser(verification.userId);

    if (!wasAlreadyRejected) {
      const recipient = customer.phone?.trim();
      if (recipient) {
        void this.notificationService
          .sendWhatsApp({
            to: recipient,
            title: "Payment verification failed",
            body: `Your payment proof for order #${verification.order.enquiryId ?? orderId} could not be verified. Reason: ${reason}`,
            idempotencyKey: `payment-rejected:${orderId}:${now.getTime()}`,
          })
          .catch(() => undefined);
      }
    }

    return this.serializeSummary({
      ...updatedVerification,
      order: { ...verification.order, paymentStatus: PaymentStatus.PENDING },
      user: customer,
    } as any);
  }

  private async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!user) {
      throw new ForbiddenException("Customer for this payment no longer exists");
    }
    return user;
  }

  private serializeSummary(v: {
    id: string;
    orderId: string;
    userId: string;
    paymentMethod: string;
    amount: any;
    status: PaymentVerificationStatus;
    screenshotFileName: string;
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    rejectionReason: string | null;
    order: {
      id: string;
      enquiryId?: string | null;
      status: OrderStatus;
      totalAmount: any;
      paymentMethod: string;
      paymentStatus?: PaymentStatus;
      advanceReservation?: { amount: any; status: string } | null;
    };
    user: { id: string; name: string | null; email: string | null; phone: string | null };
  }) {
    return {
      id: v.id,
      orderId: v.orderId,
      // Meaningful Enquiry ID (e.g. "ABC-SITE01-000123") — see
      // packages/db/lib/enquiry-id.ts. Falls back to the raw order id for
      // pre-migration orders.
      enquiryId: v.order.enquiryId ?? v.orderId,
      orderStatus: v.order.status,
      orderTotal: Number(v.order.totalAmount),
      paymentAmount: Number(v.amount),
      paymentMethod: v.paymentMethod,
      customer: { id: v.user.id, name: v.user.name, email: v.user.email, phone: v.user.phone },
      status: v.status,
      screenshotFileName: v.screenshotFileName,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      reviewedBy: v.reviewedBy,
      rejectionReason: v.rejectionReason,
      // Admin visibility (spec §33) — lets the admin answer "Advance
      // Reserved: X / Advance Status: ACTIVE" without a separate lookup.
      // null when this order never used the Buildohub Advance Balance.
      advanceReserved: v.order.advanceReservation ? Number(v.order.advanceReservation.amount) : 0,
      advanceReservationStatus: v.order.advanceReservation?.status ?? null,
      // Consumed by the admin app's own /api/admin/payments/[orderId]/screenshot
      // proxy route (apps/admin), which re-authenticates the caller via the
      // NextAuth session and forwards to this NestJS admin/payments/:orderId/
      // screenshot endpoint — never a public/static URL.
      screenshotUrl: `/api/admin/payments/${v.orderId}/screenshot`,
    };
  }
}
