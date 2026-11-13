import { Injectable, Logger } from "@nestjs/common";
import { OrderStatus, PaymentStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationEngineService } from "../notification-engine.service";

/**
 * Fallback display name when the recipient's User.name is empty — mirrors
 * the identical fallback already used by other Meta templates for a
 * personalized greeting (e.g. login OTP flows default to a generic term
 * rather than leaving {{1}} blank, which Meta rejects).
 */
const DEFAULT_BUYER_NAME = "Customer";

/**
 * Dynamic suffix for the approved `payment_required_v2` Meta URL button
 * ("Complete Payment"). Meta's approved fixed URL prefix is
 * `https://buildohub.in/orders/payment/` — i.e. the `/payment/` segment is
 * ALREADY part of the approved template's fixed prefix, NOT the dynamic
 * `{{1}}` parameter — so only the BARE `orderId` is ever sent as the
 * button's dynamic parameter, resolving to
 * `https://buildohub.in/orders/payment/{orderId}`. Sending `payment/{orderId}`
 * (the previous `payment_required` template's convention, when the approved
 * fixed prefix was only `https://buildohub.in/orders/`) would now produce a
 * broken double `/payment/payment/` URL — this is the confirmed, correct
 * suffix for `payment_required_v2` specifically, never a value derived from
 * anything other than the trusted, server-side `orderId` already used to
 * build the body parameters above. Destination:
 * `apps/web/app/(builder)/orders/payment/[id]/page.tsx` (route unchanged by
 * this task — see `getPaymentLink()` in
 * `apps/api/src/builder/orders/orders.service.ts` for the same URL
 * convention). The destination page itself (`/orders/[id]` builder API
 * route) re-authenticates the session and re-scopes the Prisma lookup to
 * `userId: user.id` — this button never grants access to an order merely
 * because its id appears in the URL.
 */
function buildPaymentButtonUrlSuffix(orderId: string): string {
  return orderId;
}

/**
 * PaymentRequiredNotificationService — the single call site every
 * PLACED -> PROCESSING order-confirmation code path in apps/api
 * (BestPriceSelectionService.selectAndFinalizeIfEligible,
 * supplier/orders/orders.service.ts OrdersService.updateStatus) calls to
 * fire the customer-facing `payment_required_v2` WhatsApp Utility template
 * through the existing Notification Engine (`NotificationEngineService.dispatch`
 * -> `NotificationPolicyService` -> `NotificationEventPolicy` template
 * registry -> `WhatsAppEngineChannel` -> `WhatsappNotificationService` ->
 * Meta Cloud API), per the `PAYMENT_REQUIRED` event type already defined in
 * `notification-event-types.ts` and seeded in
 * `packages/db/scripts/seed-notification-templates.js` (templateName
 * "payment_required_v2", metaTemplateId "1645900400305073", language "en" —
 * upgraded from the original "payment_required"/"1457666726425273" once
 * Meta approved the dynamic "Complete Payment" URL button).
 *
 * CONFIRMED LIVE FROM META GRAPH API (GET /{WABA_ID}/message_templates?name=payment_required_v2,
 * 2026-10-12 — this is the actual approved template, NOT the same body as
 * the superseded "payment_required"): body is "Hi {{1}},\n\nPayment is
 * pending for your BuildOhub order {{2}}.\n\nPlease open your order to
 * review the details and complete payment.\n\nThank you,\nTeam BuildOhub" —
 * exactly TWO body variables, {{1}}=buyer display name, {{2}}=order display
 * ID. There is NO amount-payable or payment-deadline variable in the
 * approved copy — sending 3 parameters (the old "payment_required"
 * contract) is REJECTED by Meta with HTTP 400 code=132000 "Number of
 * parameters does not match the expected number of params". This was a
 * real production incident (order EQ/2607/00003 and likely every
 * PAYMENT_REQUIRED send since the payment_required_v2 cutover never
 * delivered) — never assume a template's body contract is unchanged across
 * a Meta template name change without verifying via the Graph API.
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
      const buyerName = order.user.name?.trim() || DEFAULT_BUYER_NAME;

      const dedupeKey = `PAYMENT_REQUIRED:${orderId}`;

      const result = await this.engine.dispatch(
        {
          eventType: "PAYMENT_REQUIRED",
          recipientId: order.userId,
          recipientType: "builder",
          entityType: "Order",
          entityId: orderId,
          phone,
          // Exactly 2 parameters, matching the approved payment_required_v2
          // template's actual body contract — see class doc comment above.
          parameters: [buyerName, enquiryDisplayId],
          title: "Payment Required",
          body: `Hi ${buyerName}, payment is pending for your BuildOhub order ${enquiryDisplayId}. Please open your order to review the details and complete payment.`,
          buttonUrlSuffix: buildPaymentButtonUrlSuffix(orderId),
          dedupeKey,
          payload: {
            orderId,
            enquiryDisplayId,
            buyerName,
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
