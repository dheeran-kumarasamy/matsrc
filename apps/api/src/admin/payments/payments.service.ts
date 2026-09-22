import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, PaymentVerificationStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationService } from "src/notifications/notification.service";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService
  ) {}

  // List every order whose bank-transfer payment proof is currently
  // PENDING admin review, for the admin payments queue.
  async findPendingVerifications() {
    const verifications = await this.prisma.paymentVerification.findMany({
      where: { status: PaymentVerificationStatus.PENDING },
      include: {
        order: { select: { id: true, status: true, totalAmount: true, paymentMethod: true } },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { submittedAt: "asc" },
    });

    return verifications.map((v) => this.serializeSummary(v));
  }

  // Full detail for a single order's payment verification, for the admin
  // review screen (excludes the raw screenshot bytes — those are only ever
  // served by the dedicated screenshot route below, gated the same way).
  async findOne(orderId: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      include: {
        order: { select: { id: true, status: true, totalAmount: true, paymentMethod: true, paymentStatus: true } },
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

    const [updatedVerification] = await this.prisma.$transaction([
      this.prisma.paymentVerification.update({
        where: { id: verification.id },
        data: {
          status: PaymentVerificationStatus.APPROVED,
          reviewedAt: now,
          reviewedBy: actorId,
          rejectionReason: null,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.PAID,
          // Existing order-confirmation transition: a PLACED enquiry moves
          // to PROCESSING once payment clears, which is what the existing
          // supplier-facing order list/tracking already treats as
          // "confirmed and being processed" (see
          // apps/api/src/supplier/reports/reports.service.ts and
          // BuilderOrdersService.paymentLinkAvailable).
          status: verification.order.status === OrderStatus.PLACED ? OrderStatus.PROCESSING : verification.order.status,
        },
      }),
      this.prisma.orderTracking.create({
        data: {
          orderId,
          status: OrderStatus.PROCESSING,
          note: "Payment verified by admin — order confirmed for supplier processing",
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: "PAYMENT_VERIFICATION_APPROVED",
          entityType: "PaymentVerification",
          entityId: verification.id,
          metadata: { orderId, amount: Number(verification.amount) },
        },
      }),
    ]);

    const customer = await this.getUser(verification.userId);

    // Best-effort customer notification — never blocks the approval itself.
    const recipient = customer.phone?.trim();
    if (recipient) {
      void this.notificationService
        .sendWhatsApp({
          to: recipient,
          title: "Payment approved",
          body: `Your payment for order #${orderId.slice(0, 8)} has been verified. Your order is now being processed.`,
          idempotencyKey: `payment-approved:${orderId}`,
        })
        .catch(() => undefined);
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

    const [updatedVerification] = await this.prisma.$transaction([
      this.prisma.paymentVerification.update({
        where: { id: verification.id },
        data: {
          status: PaymentVerificationStatus.REJECTED,
          reviewedAt: now,
          reviewedBy: actorId,
          rejectionReason: reason,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: PaymentStatus.PENDING },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: "PAYMENT_VERIFICATION_REJECTED",
          entityType: "PaymentVerification",
          entityId: verification.id,
          metadata: { orderId, reason },
        },
      }),
    ]);

    const customer = await this.getUser(verification.userId);

    if (!wasAlreadyRejected) {
      const recipient = customer.phone?.trim();
      if (recipient) {
        void this.notificationService
          .sendWhatsApp({
            to: recipient,
            title: "Payment verification failed",
            body: `Your payment proof for order #${orderId.slice(0, 8)} could not be verified. Reason: ${reason}`,
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
    order: { id: string; status: OrderStatus; totalAmount: any; paymentMethod: string; paymentStatus?: PaymentStatus };
    user: { id: string; name: string | null; email: string | null; phone: string | null };
  }) {
    return {
      id: v.id,
      orderId: v.orderId,
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
      // Consumed by the admin app's own /api/admin/payments/[orderId]/screenshot
      // proxy route (apps/admin), which re-authenticates the caller via the
      // NextAuth session and forwards to this NestJS admin/payments/:orderId/
      // screenshot endpoint — never a public/static URL.
      screenshotUrl: `/api/admin/payments/${v.orderId}/screenshot`,
    };
  }
}
