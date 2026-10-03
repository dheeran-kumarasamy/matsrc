import { Injectable, Logger } from "@nestjs/common";
import { OrderStatus, PaymentStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationEngineService } from "../notification-engine.service";

/** Mirrors apps/web/lib/builder-db.ts's formatCurrency exactly — see packages/db/lib/payment-required-notification.ts's doc comment for why this is the canonical amount formatting. */
function formatAmount(amount: { toNumber?: () => number } | number | string): string {
  const n = Number(amount);
  return `₹${n.toLocaleString("en-IN")}`;
}

/** Days before the payment deadline shown in {{3}} — same PAYMENT_DUE_DAYS env var/default as packages/db/lib/payment-required-notification.ts (never a second/duplicated config surface). */
function getPaymentDueDays(): number {
  const raw = process.env.PAYMENT_DUE_DAYS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2;
}

function formatDeadline(from: Date = new Date()): string {
  const deadline = new Date(from);
  deadline.setDate(deadline.getDate() + getPaymentDueDays());
  return deadline.toLocaleDateString("en-IN");
}

/**
 * PaymentRequiredNotificationService — the single call site every
 * PLACED -> PROCESSING order-confirmation code path in apps/api
 * (BestPriceSelectionService.selectAndFinalizeIfEligible,
 * supplier/orders/orders.service.ts OrdersService.updateStatus) calls to
 * fire the customer-facing `payment_required` WhatsApp Utility template
 * through the existing Notification Engine (`NotificationEngineService.dispatch`
 * -> `NotificationPolicyService` -> `NotificationEventPolicy` template
 * registry -> `WhatsAppEngineChannel` -> `WhatsappNotificationService` ->
 * Meta Cloud API), per the `PAYMENT_REQUIRED` event type already defined in
 * `notification-event-types.ts` and seeded in
 * `packages/db/scripts/seed-notification-templates.js` (templateName
 * "payment_required", metaTemplateId "1457666726425273", language "en").
 *
 * Deliberately NOT a new/parallel notification system — mirrors
 * `CustomerOrderStatusNotificationService` exactly. apps/supplier (a
 * separate Next.js deployable that cannot inject this NestJS service)
 * instead calls the shared, framework-agnostic `notifyPaymentRequired()` in
 * `packages/db/lib/payment-required-notification.ts` directly — both
 * implementations enforce identical trigger/policy/dedupe/template
 * semantics against the same NotificationEventPolicy row, so there is
 * exactly one logical send path for this notification regardless of which
 * app triggers it.
 *
 * See packages/db/lib/payment-required-notification.ts's top doc comment
 * for the full audit of why PLACED -> PROCESSING (while paymentStatus is
 * still PENDING) is the correct, narrow trigger — NOT every payment-status
 * update, and NOT the admin payment-approval path (which always sets
 * paymentStatus: PAID in the same mutation, so there is nothing left to
 * pay).
 *
 * Never throws to callers and never blocks/rolls back the underlying order
 * mutation — same contract as every other fire-and-forget notification call
 * site in this codebase. Callers MUST invoke `notifyIfTransitioned()` only
 * AFTER the order-status mutation has already committed, never inside the
 * same transaction.
 */
@Injectable()
export class PaymentRequiredNotificationService {
  private readonly logger = new Logger(PaymentRequiredNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: NotificationEngineService
  ) {}

  async notifyIfTransitioned(params: {
    orderId: string;
    previousStatus: OrderStatus | null;
    newStatus: OrderStatus;
  }): Promise<void> {
    const { orderId, previousStatus, newStatus } = params;

    if (previousStatus !== OrderStatus.PLACED || newStatus !== OrderStatus.PROCESSING) {
      // Not the one business event this notification represents — see
      // packages/db/lib/payment-required-notification.ts's doc comment.
      return;
    }

    try {
      const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
      if (!order) {
        this.logger.warn(`PAYMENT_REQUIRED: order ${orderId} not found — skipping notification`);
        return;
      }

      if (order.paymentStatus !== PaymentStatus.PENDING) {
        // Already paid (e.g. admin payment-approval, which sets
        // paymentStatus: PAID in the same mutation) — nothing to notify.
        this.logger.debug(
          `PAYMENT_REQUIRED: order ${orderId} paymentStatus is ${order.paymentStatus} (not PENDING) — skipping`
        );
        return;
      }

      const phone = order.user.whatsappNumber?.trim() || order.user.phone?.trim() || null;
      const enquiryDisplayId = order.enquiryId ?? order.id;
      const amountPayable = formatAmount(order.totalAmount as any);
      const paymentDeadline = formatDeadline();

      const dedupeKey = `PAYMENT_REQUIRED:${orderId}`;

      const result = await this.engine.dispatch(
        {
          eventType: "PAYMENT_REQUIRED",
          recipientId: order.userId,
          recipientType: "builder",
          entityType: "Order",
          entityId: orderId,
          phone,
          parameters: [enquiryDisplayId, amountPayable, paymentDeadline],
          title: "Payment Required",
          body: `Payment is required for your Buildohub requirement ${enquiryDisplayId}. Amount payable: ${amountPayable}. Payment deadline: ${paymentDeadline}. Please complete the payment to proceed with your order.`,
          dedupeKey,
          payload: {
            orderId,
            enquiryDisplayId,
            amountPayable,
            paymentDeadline,
            entityType: "Order",
            entityId: orderId,
          },
        },
        "WHATSAPP"
      );

      if (!result.allowed) {
        this.logger.debug(`PAYMENT_REQUIRED suppressed for order=${orderId}: reason=${result.reason}`);
      } else if (!result.sendResult?.success) {
        this.logger.warn(
          `PAYMENT_REQUIRED WhatsApp send failed for order=${orderId}: ${result.sendResult?.error ?? "unknown error"}`
        );
      }
    } catch (error) {
      // Never let a notification-engine failure affect the order-status
      // transition that already committed — same contract as every other
      // fire-and-forget WhatsApp integration in this codebase.
      this.logger.warn(
        `PAYMENT_REQUIRED notification failed for order=${orderId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
