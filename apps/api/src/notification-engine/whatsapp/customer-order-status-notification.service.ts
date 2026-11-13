import { Injectable, Logger } from "@nestjs/common";
import { OrderStatus, getOrderStatusDisplayLabel, writeInAppOrderStatusAlert } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationEngineService } from "../notification-engine.service";

/**
 * CustomerOrderStatusNotificationService — the single call site every
 * Order-status-changing code path (supplier actions, admin payment approval,
 * aggregation pool lock/opt-out, best-price-selection auto-confirmation,
 * WhatsApp bot flows, scheduled jobs, etc.) calls to fire the customer-facing
 * `customer_order_status` WhatsApp Utility template through the existing
 * Notification Engine (`NotificationEngineService.dispatch` ->
 * `NotificationPolicyService` -> `NotificationEventPolicy` template registry
 * -> `WhatsAppEngineChannel` -> `WhatsappNotificationService` -> Meta Cloud
 * API), per the `ORDER_STATUS_CHANGED` event type already defined in
 * `notification-event-types.ts` and already seeded in
 * `packages/db/scripts/seed-notification-templates.js` (templateName
 * "customer_order_status", metaTemplateId "1788249542353441").
 *
 * Deliberately NOT a new/parallel notification system — this is a thin,
 * single-purpose wrapper around the existing engine so every call site needs
 * only the order id + previous/new status, and the transition-guard
 * (previousStatus !== newStatus), dedupe key, recipient resolution, and
 * display-label mapping are done exactly once, here, instead of being
 * duplicated at every one of the ~6 order-status mutation call sites found
 * in this repository (see the deliverables report).
 *
 * Never throws to callers and never blocks/rolls back the underlying order
 * mutation — mirrors the exact same contract as `WhatsAppAlertService`,
 * `WhatsAppLifecycleService`, and `SupplierDailyPriceReminderService`, all of
 * which are only ever awaited inside a `.catch()`-guarded fire-and-forget
 * call from business logic.
 */
@Injectable()
export class CustomerOrderStatusNotificationService {
  private readonly logger = new Logger(CustomerOrderStatusNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: NotificationEngineService
  ) {}

  /**
   * Notifies the customer that their enquiry/order's status changed.
   *
   * Only ever fires when `previousStatus !== newStatus` — a caller passing
   * the same status twice (e.g. a retried/duplicate request that produces no
   * actual transition) is a silent no-op, never a duplicate notification.
   * Initial order creation (no meaningful "previous" status — see spec §10)
   * must be represented by the caller passing `previousStatus: null`, which
   * this method also treats as "no notification" unless `previousStatus` is
   * a real, different `OrderStatus`.
   */
  async notifyIfTransitioned(params: {
    orderId: string;
    previousStatus: OrderStatus | null;
    newStatus: OrderStatus;
    /** Optional idempotency salt for retries of the exact same logical operation (e.g. a webhook delivery id) — defaults to the order+status pair, which is already stable across simple retries since the dedupe key never includes a timestamp. */
    transitionIdentity?: string;
  }): Promise<void> {
    const { orderId, previousStatus, newStatus, transitionIdentity } = params;

    if (previousStatus === null || previousStatus === newStatus) {
      // No real transition (either initial creation or a same-status
      // re-save) — never notify. See spec §4/§10.
      return;
    }

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true, items: { include: { supplier: true } } },
      });
      if (!order) {
        this.logger.warn(`ORDER_STATUS_CHANGED: order ${orderId} not found — skipping notification`);
        return;
      }

      // In-app Alerts bell write (Notification table) — see
      // packages/db/lib/customer-order-status-notification.ts's
      // writeInAppOrderStatusAlert doc comment for the full audit of why
      // this additive write exists alongside the WhatsApp send below.
      // Shared with apps/supplier's direct call to
      // notifyCustomerOrderStatusChanged() so both implementations produce
      // identical Notification rows; never blocks/affects the WhatsApp
      // dispatch that follows.
      await writeInAppOrderStatusAlert(
        this.prisma as any,
        order,
        newStatus,
        (message) => this.logger.warn(message)
      );

      const phone = order.user.whatsappNumber?.trim() || order.user.phone?.trim() || null;
      const enquiryDisplayId = order.enquiryId ?? order.id;
      const displayStatus = getOrderStatusDisplayLabel(newStatus);

      const dedupeKey = transitionIdentity
        ? `ORDER_STATUS_CHANGED:${orderId}:${previousStatus}:${newStatus}:${transitionIdentity}`
        : `ORDER_STATUS_CHANGED:${orderId}:${previousStatus}:${newStatus}`;

      const result = await this.engine.dispatch(
        {
          eventType: "ORDER_STATUS_CHANGED",
          recipientId: order.userId,
          recipientType: "builder",
          entityType: "Order",
          entityId: orderId,
          phone,
          parameters: [enquiryDisplayId, displayStatus],
          title: "Order Status Update",
          body: `Your Buildohub order ${enquiryDisplayId} has been updated. The current status is ${displayStatus}. Please check your Buildohub account for the latest delivery information.`,
          dedupeKey,
          payload: {
            orderId,
            previousStatus,
            newStatus,
            displayStatus,
            entityType: "Order",
            entityId: orderId,
          },
        },
        "WHATSAPP"
      );

      if (!result.allowed) {
        this.logger.debug(
          `ORDER_STATUS_CHANGED suppressed for order=${orderId} (${previousStatus} -> ${newStatus}): reason=${result.reason}`
        );
      } else if (!result.sendResult?.success) {
        this.logger.warn(
          `ORDER_STATUS_CHANGED WhatsApp send failed for order=${orderId} (${previousStatus} -> ${newStatus}): ${result.sendResult?.error ?? "unknown error"}`
        );
      }
    } catch (error) {
      // Never let a notification-engine failure affect the order-status
      // transition that already committed — same contract as every other
      // fire-and-forget WhatsApp integration in this codebase.
      this.logger.warn(
        `ORDER_STATUS_CHANGED notification failed for order=${orderId} (${previousStatus} -> ${newStatus}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
