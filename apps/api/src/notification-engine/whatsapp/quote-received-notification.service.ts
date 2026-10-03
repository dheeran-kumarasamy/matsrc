import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationEngineService } from "../notification-engine.service";

/**
 * QuoteReceivedNotificationService — the single call site every supplier
 * quotation-submission code path in apps/api calls to fire the
 * builder/customer-facing `quote_received` WhatsApp Utility template through
 * the existing Notification Engine (`NotificationEngineService.dispatch` ->
 * `NotificationPolicyService` -> `NotificationEventPolicy` template registry
 * -> `WhatsAppEngineChannel` -> `WhatsappNotificationService` -> Meta Cloud
 * API), per the `QUOTE_RECEIVED` event type already defined in
 * `notification-event-types.ts` and seeded in
 * `packages/db/scripts/seed-notification-templates.js` (templateName
 * "quote_received", metaTemplateId "1055000930652376", language "en").
 *
 * AUDIT (repository evidence): the canonical, builder-visible "a supplier
 * has submitted a quotation" entity in this codebase is `SupplierQuote`
 * (enquiryId=Order.id, lineItemId=OrderItem.id) — NOT the separate
 * `Quote`/`QuickRequest` pair, which has no reachable builder-facing UI to
 * ever surface a result (the homepage "Quick Material Request" form reuses
 * the ordinary cart/checkout Order/OrderItem pipeline, never QuickRequest —
 * see apps/web/lib/order-checkout.ts's own doc comment). `SupplierQuote`
 * rows are created in exactly one place,
 * `RfqsService.createEnquiryLineQuotes` (private), reached from BOTH of the
 * only two real production call sites:
 *   1. `RfqsController`'s `POST /supplier/rfqs/:id/quotes` (RfqsService.createQuote).
 *   2. The Supplier WhatsApp bot's Accept-with-quote flow
 *      (`EnquiryDecisionFlow.handleQuotedPrice` -> `RfqsService.createQuote`).
 * Wiring this notification at the bottom of `createEnquiryLineQuotes` (after
 * the `SupplierQuote` rows have already committed) therefore covers both
 * paths with a single call site — never a draft/incomplete quote, since
 * there is no draft/save-without-submit concept for `SupplierQuote`: the
 * row is created transactionally, in full, or not at all.
 *
 * Deliberately NOT a new/parallel notification system — mirrors
 * `SupplierPoReceivedNotificationService` exactly.
 *
 * Never throws to callers and never blocks/rolls back the underlying quote
 * submission — same contract as every other fire-and-forget notification
 * call site in this codebase. Callers MUST invoke `notify()` only AFTER the
 * `SupplierQuote` row(s) have already committed.
 */
@Injectable()
export class QuoteReceivedNotificationService {
  private readonly logger = new Logger(QuoteReceivedNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: NotificationEngineService
  ) {}

  /**
   * @param quoteIds   the `SupplierQuote.id`s created by this single
   *                   submission (one notification per submission, not per
   *                   line item — mirrors `supplier_po_alert`'s per-PO,
   *                   not per-line-item, granularity).
   */
  async notify(enquiryId: string, supplierId: string, quoteIds: string[]): Promise<void> {
    if (quoteIds.length === 0) {
      return;
    }

    try {
      const [order, quotes] = await Promise.all([
        this.prisma.order.findUnique({ where: { id: enquiryId }, include: { user: true } }),
        this.prisma.supplierQuote.findMany({
          where: { id: { in: quoteIds } },
          include: { lineItem: { include: { product: true } } },
        }),
      ]);

      if (!order) {
        this.logger.warn(`QUOTE_RECEIVED: enquiry ${enquiryId} not found — skipping notification`);
        return;
      }

      if (quotes.length === 0) {
        this.logger.warn(`QUOTE_RECEIVED: no SupplierQuote rows found for ids=${quoteIds.join(",")} — skipping notification`);
        return;
      }

      const phone = order.user.whatsappNumber?.trim() || order.user.phone?.trim() || null;
      const enquiryDisplayId = order.enquiryId ?? order.id;
      const material = summarizeMaterials(quotes);
      const quantity = summarizeQuantities(quotes);

      const lineItemIds = Array.from(new Set(quotes.map((q) => q.lineItemId))).sort();
      const dedupeKey = `QUOTE_RECEIVED:${enquiryId}:${supplierId}:${lineItemIds.join(",")}`;

      const result = await this.engine.dispatch(
        {
          eventType: "QUOTE_RECEIVED",
          recipientId: order.userId,
          recipientType: "builder",
          entityType: "Order",
          entityId: enquiryId,
          phone,
          parameters: [enquiryDisplayId, material, quantity],
          title: "Quote Received",
          body: `A supplier has submitted a quotation for your requirement ${enquiryDisplayId}. Material: ${material}. Quantity: ${quantity}. Please review the quotation on Buildohub.`,
          dedupeKey,
          payload: { enquiryId, supplierId, quoteIds, enquiryDisplayId, material, quantity },
        },
        "WHATSAPP"
      );

      if (!result.allowed) {
        this.logger.debug(`QUOTE_RECEIVED suppressed for enquiry=${enquiryId} supplier=${supplierId}: reason=${result.reason}`);
      } else if (!result.sendResult?.success) {
        this.logger.warn(
          `QUOTE_RECEIVED WhatsApp send failed for enquiry=${enquiryId} supplier=${supplierId}: ${result.sendResult?.error ?? "unknown error"}`
        );
      }
    } catch (error) {
      this.logger.warn(
        `QUOTE_RECEIVED notification failed for enquiry=${enquiryId} supplier=${supplierId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

const MAX_SUMMARY_ITEMS = 3;

function summarizeMaterials(quotes: Array<{ lineItem?: { product?: { name?: string | null } | null } | null }>): string {
  if (!quotes.length) return "your requested material";
  const names = quotes.slice(0, MAX_SUMMARY_ITEMS).map((q) => q.lineItem?.product?.name ?? "Item");
  if (quotes.length > MAX_SUMMARY_ITEMS) names.push(`+${quotes.length - MAX_SUMMARY_ITEMS} more`);
  return names.join(", ");
}

function summarizeQuantities(
  quotes: Array<{ lineItem?: { quantity: number; product?: { unit?: string | null } | null } | null }>
): string {
  if (!quotes.length) return "—";
  const quantities = quotes
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((q) => `${q.lineItem?.quantity ?? "—"}${q.lineItem?.product?.unit ? ` ${q.lineItem.product.unit}` : ""}`);
  if (quotes.length > MAX_SUMMARY_ITEMS) quantities.push(`+${quotes.length - MAX_SUMMARY_ITEMS} more`);
  return quantities.join(", ");
}
