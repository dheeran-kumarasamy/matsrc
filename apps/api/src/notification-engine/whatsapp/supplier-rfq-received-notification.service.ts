import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationEngineService } from "../notification-engine.service";

const DEFAULT_QUOTE_DEADLINE_MS = 24 * 60 * 60 * 1000;
const NO_DELIVERY_LOCATION_FALLBACK = "See order for delivery details";

function resolveQuoteDeadline(orderCreatedAt: Date): Date {
  const parsed = Number(process.env.QUOTE_DEADLINE_MINUTES);
  const minutesMs = Number.isFinite(parsed) && parsed > 0 ? parsed * 60 * 1000 : DEFAULT_QUOTE_DEADLINE_MS;
  return new Date(orderCreatedAt.getTime() + minutesMs);
}

function formatQuoteDeadlineLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(value);
}

/**
 * Dynamic suffix for the approved `supplier_quote_alert` Meta URL button
 * ("Review RFQ"). CONFIRMED LIVE directly against the Graph API (GET
 * /{WABA_ID}/message_templates?name=supplier_quote_alert, verified
 * 2026-10-12 — the button was upgraded from a static QUICK_REPLY to a URL
 * CTA; the body (4 parameters: material, quantity, delivery location, quote
 * deadline) is UNCHANGED): approved fixed URL prefix is
 * `https://supplier.buildohub.in/orders/{{1}}` — NO query string/`respond`
 * parameter is part of the approved configuration (Meta URL buttons only
 * support a single trailing dynamic path segment, never a dynamic query
 * string). The destination page
 * (`apps/supplier/app/(supplier)/orders/[id]/page.tsx`) has no `searchParams`
 * prop at all and unconditionally renders the quotation form whenever the
 * underlying Order is still PLACED, so a `?respond=` suffix was never
 * required for this destination in the first place (that query param only
 * applies to the separate `/rfqs` page, which serves `QuickRequest` rows —
 * an entity this event does NOT fire for; see this file's class doc comment
 * / packages/db/lib/supplier-rfq-received-notification.ts's top doc comment
 * for the full audit of the real OrderItem-based trigger).
 *
 * The dynamic `{{1}}` is the OrderItem's PARENT Order id (`orderItem.orderId`)
 * — never the OrderItem's own id — because the destination route
 * `/orders/[id]` is keyed by Order.id (confirmed via
 * `getSupplierOrderDetail(orderId, email)`'s `prisma.orderItem.findFirst({
 * where: { orderId, supplierId } })` lookup in apps/supplier/lib/supplier-data.ts,
 * and by `RfqCard.tsx`'s existing `/orders/${rfq.id}` link, where `rfq.id` is
 * already `item.orderId` for this exact ENQUIRY-sourced card type). That
 * page's `getSupplierOrderDetail()` re-authenticates the session and
 * re-scopes the Prisma lookup to `supplierId: supplierProfile.id` — this
 * button never grants access to an order merely because its id appears in
 * the URL, and it only ever navigates to a read/quote-form page, never
 * auto-submits a quote.
 */
function buildRfqButtonUrlSuffix(orderId: string): string {
  return orderId;
}

/**
 * SupplierRfqReceivedNotificationService — the single call site every
 * RFQ-dispatch-to-supplier code path in apps/api (BuilderOrdersService.create
 * and OrdersService's candidate-promotion decline cascade) calls to fire the
 * supplier-facing `supplier_quote_alert` WhatsApp Utility template through
 * the existing Notification Engine (`NotificationEngineService.dispatch` ->
 * `NotificationPolicyService` -> `NotificationEventPolicy` template registry
 * -> `WhatsAppEngineChannel` -> `WhatsappNotificationService` -> Meta Cloud
 * API), per the `SUPPLIER_RFQ_RECEIVED` event type already defined in
 * `notification-event-types.ts` and already seeded in
 * `packages/db/scripts/seed-notification-templates.js` (templateName
 * "supplier_quote_alert", metaTemplateId "2046949149261282").
 *
 * CONFIRMED LIVE FROM META GRAPH API (GET /{WABA_ID}/message_templates?name=supplier_quote_alert,
 * 2026-10-12): body is unchanged — 4 parameters (material, quantity,
 * delivery location, quote deadline) — the only change is the button,
 * upgraded from a static "Review RFQ" QUICK_REPLY to a "Review RFQ" URL CTA
 * with approved fixed prefix `https://supplier.buildohub.in/orders/{{1}}`
 * (no query string). See `buildRfqButtonUrlSuffix`'s doc comment above for
 * the exact dynamic-parameter format and why no `?respond=` suffix is sent.
 *
 * Deliberately NOT a new/parallel notification system — mirrors
 * `CustomerOrderStatusNotificationService` exactly. apps/web and
 * apps/supplier (separate Next.js deployables that cannot inject this
 * NestJS service) instead call the shared, framework-agnostic
 * `notifySupplierRfqReceived()` in `packages/db/lib/supplier-rfq-received-notification.ts`
 * directly — both implementations enforce identical policy/dedupe/template
 * semantics against the same NotificationEventPolicy row, so there is
 * exactly one logical send path for this notification regardless of which
 * app triggers it.
 *
 * Never throws to callers and never blocks/rolls back the underlying
 * RFQ/order mutation — same contract as every other fire-and-forget
 * notification call site in this codebase.
 */
@Injectable()
export class SupplierRfqReceivedNotificationService {
  private readonly logger = new Logger(SupplierRfqReceivedNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: NotificationEngineService
  ) {}

  /**
   * Notifies the supplier currently assigned to `orderItemId` that they have
   * an RFQ awaiting their quotation. Safe to call both at initial
   * OrderItem/Order creation and after a candidate-promotion reassignment —
   * the dedupe key (`SUPPLIER_RFQ_RECEIVED:{orderItemId}:{supplierId}`)
   * naturally distinguishes a brand-new assignment from a retried call
   * against the exact same one.
   */
  async notify(orderItemId: string): Promise<void> {
    try {
      const orderItem = await this.prisma.orderItem.findUnique({
        where: { id: orderItemId },
        include: { product: true, order: true, supplier: { include: { user: true } } },
      });

      if (!orderItem) {
        this.logger.warn(`SUPPLIER_RFQ_RECEIVED: orderItem ${orderItemId} not found — skipping notification`);
        return;
      }

      const supplierId = orderItem.supplierId;
      const supplierUser = orderItem.supplier?.user;
      if (!supplierUser) {
        this.logger.warn(`SUPPLIER_RFQ_RECEIVED: no supplier/user for orderItem=${orderItemId} supplier=${supplierId} — skipping`);
        return;
      }

      const phone = supplierUser.whatsappNumber?.trim() || supplierUser.phone?.trim() || null;
      const material = orderItem.product?.name ?? "your requested material";
      const quantity = `${orderItem.quantity}${orderItem.product?.unit ? ` ${orderItem.product.unit}` : ""}`;
      const deliveryLocation = orderItem.order?.deliveryAddress?.trim() || NO_DELIVERY_LOCATION_FALLBACK;
      const quoteDeadline = formatQuoteDeadlineLabel(resolveQuoteDeadline(orderItem.order?.createdAt ?? new Date()));

      const dedupeKey = `SUPPLIER_RFQ_RECEIVED:${orderItemId}:${supplierId}`;

      const result = await this.engine.dispatch(
        {
          eventType: "SUPPLIER_RFQ_RECEIVED",
          recipientId: supplierUser.id,
          recipientType: "supplier",
          entityType: "OrderItem",
          entityId: orderItemId,
          phone,
          parameters: [material, quantity, deliveryLocation, quoteDeadline],
          title: "New RFQ Received",
          body: `New quotation request from Buildohub. Material: ${material}. Quantity: ${quantity}. Delivery location: ${deliveryLocation}. Quote by: ${quoteDeadline}.`,
          buttonUrlSuffix: buildRfqButtonUrlSuffix(orderItem.orderId),
          dedupeKey,
          payload: {
            orderItemId,
            orderId: orderItem.orderId,
            supplierId,
            material,
            quantity,
            deliveryLocation,
            quoteDeadline,
          },
        },
        "WHATSAPP"
      );

      if (!result.allowed) {
        this.logger.debug(`SUPPLIER_RFQ_RECEIVED suppressed for orderItem=${orderItemId} supplier=${supplierId}: reason=${result.reason}`);
      } else if (!result.sendResult?.success) {
        this.logger.warn(
          `SUPPLIER_RFQ_RECEIVED WhatsApp send failed for orderItem=${orderItemId} supplier=${supplierId}: ${result.sendResult?.error ?? "unknown error"}`
        );
      }
    } catch (error) {
      this.logger.warn(
        `SUPPLIER_RFQ_RECEIVED notification failed for orderItem=${orderItemId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
