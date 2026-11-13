import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationEngineService } from "../notification-engine.service";

const MAX_SUMMARY_ITEMS = 3;

function summarizeMaterials(lineItems: Array<{ product?: { name?: string | null } | null }>): string {
  if (!lineItems.length) return "your requested material";
  const names = lineItems.slice(0, MAX_SUMMARY_ITEMS).map((li) => li.product?.name ?? "Item");
  if (lineItems.length > MAX_SUMMARY_ITEMS) names.push(`+${lineItems.length - MAX_SUMMARY_ITEMS} more`);
  return names.join(", ");
}

function summarizeQuantities(lineItems: Array<{ quantity: number; product?: { unit?: string | null } | null }>): string {
  if (!lineItems.length) return "—";
  const quantities = lineItems
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((li) => `${li.quantity}${li.product?.unit ? ` ${li.product.unit}` : ""}`);
  if (lineItems.length > MAX_SUMMARY_ITEMS) quantities.push(`+${lineItems.length - MAX_SUMMARY_ITEMS} more`);
  return quantities.join(", ");
}

/**
 * Dynamic suffix for the approved `supplier_po_alert` Meta URL button
 * ("View Purchase Order"). CONFIRMED LIVE directly against the Graph API
 * (GET /{WABA_ID}/message_templates?name=supplier_po_alert, verified
 * 2026-10-12 — the button was upgraded from a static QUICK_REPLY to a URL
 * CTA; the body (3 parameters: PO/order ID, material, quantity) is
 * UNCHANGED): approved fixed URL prefix is
 * `https://supplier.buildohub.in/purchase-orders/{{1}}` — the
 * `/purchase-orders/` segment is already part of the fixed prefix, NOT the
 * dynamic `{{1}}` parameter, so only the BARE `purchaseOrderId` is ever sent
 * as the button's dynamic parameter, resolving to
 * `https://supplier.buildohub.in/purchase-orders/{purchaseOrderId}` — which
 * matches the existing, already-authenticated supplier PO detail page at
 * `apps/supplier/app/(supplier)/purchase-orders/[id]/page.tsx` (route
 * unchanged by this task). That page's `getSupplierPurchaseOrderDetail()`
 * re-authenticates the session and re-scopes the Prisma lookup to
 * `supplierId: supplierProfile.id` — this button never grants access to a
 * PO merely because its id appears in the URL.
 */
function buildPurchaseOrderButtonUrlSuffix(purchaseOrderId: string): string {
  return purchaseOrderId;
}

/**
 * SupplierPoReceivedNotificationService — the single call site every
 * PO-issuance code path in apps/api (PurchaseOrdersService.approve) calls to
 * fire the supplier-facing `supplier_po_alert` WhatsApp Utility template
 * through the existing Notification Engine (`NotificationEngineService.dispatch`
 * -> `NotificationPolicyService` -> `NotificationEventPolicy` template
 * registry -> `WhatsAppEngineChannel` -> `WhatsappNotificationService` ->
 * Meta Cloud API), per the `SUPPLIER_PO_RECEIVED` event type already defined
 * in `notification-event-types.ts` and already seeded in
 * `packages/db/scripts/seed-notification-templates.js` (templateName
 * "supplier_po_alert", metaTemplateId "1999605497419495", language "en").
 *
 * CONFIRMED LIVE FROM META GRAPH API (GET /{WABA_ID}/message_templates?name=supplier_po_alert,
 * 2026-10-12): body is unchanged — 3 parameters (PO/order display ID,
 * material, quantity) — the only change is the button, upgraded from a
 * static "View Purchase Order" QUICK_REPLY to a "View Purchase Order" URL
 * CTA with approved fixed prefix
 * `https://supplier.buildohub.in/purchase-orders/{{1}}`. See
 * `buildPurchaseOrderButtonUrlSuffix`'s doc comment above for the exact
 * dynamic-parameter format.
 *
 * Deliberately NOT a new/parallel notification system — mirrors
 * `SupplierRfqReceivedNotificationService` exactly. apps/web (a separate
 * Next.js deployable that cannot inject this NestJS service) instead calls
 * the shared, framework-agnostic `notifySupplierPoReceived()` in
 * `packages/db/lib/supplier-po-received-notification.ts` directly — both
 * implementations enforce identical policy/dedupe/template semantics
 * against the same NotificationEventPolicy row, so there is exactly one
 * logical send path for this notification regardless of which app triggers
 * it.
 *
 * Never throws to callers and never blocks/rolls back the underlying PO
 * approval mutation — same contract as every other fire-and-forget
 * notification call site in this codebase. Callers MUST invoke `notify()`
 * only AFTER `PurchaseOrder.status` has already been committed as ISSUED.
 */
@Injectable()
export class SupplierPoReceivedNotificationService {
  private readonly logger = new Logger(SupplierPoReceivedNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: NotificationEngineService
  ) {}

  async notify(purchaseOrderId: string): Promise<void> {
    try {
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { supplier: { include: { user: true } }, lineItems: { include: { product: true } } },
      });

      if (!po) {
        this.logger.warn(`SUPPLIER_PO_RECEIVED: purchaseOrder ${purchaseOrderId} not found — skipping notification`);
        return;
      }

      if (po.status !== "ISSUED") {
        this.logger.debug(
          `SUPPLIER_PO_RECEIVED: purchaseOrder ${purchaseOrderId} is not ISSUED (status=${po.status}) — skipping`
        );
        return;
      }

      const supplierId = po.supplierId;
      const supplierUser = po.supplier?.user;
      if (!supplierUser) {
        this.logger.warn(
          `SUPPLIER_PO_RECEIVED: no supplier/user for purchaseOrder=${purchaseOrderId} supplier=${supplierId} — skipping`
        );
        return;
      }

      const phone = supplierUser.whatsappNumber?.trim() || supplierUser.phone?.trim() || null;
      const lineItems = po.lineItems ?? [];
      const poDisplayId = po.poNumber ?? po.id;
      const material = summarizeMaterials(lineItems);
      const quantity = summarizeQuantities(lineItems);

      const dedupeKey = `SUPPLIER_PO_RECEIVED:${purchaseOrderId}:${supplierId}`;

      const result = await this.engine.dispatch(
        {
          eventType: "SUPPLIER_PO_RECEIVED",
          recipientId: supplierUser.id,
          recipientType: "supplier",
          entityType: "PurchaseOrder",
          entityId: purchaseOrderId,
          phone,
          parameters: [poDisplayId, material, quantity],
          title: "Purchase Order Issued",
          body: `A purchase order ${poDisplayId} has been issued to you by Buildohub. Material: ${material}. Quantity: ${quantity}. Please review the purchase order on Buildohub.`,
          buttonUrlSuffix: buildPurchaseOrderButtonUrlSuffix(purchaseOrderId),
          dedupeKey,
          payload: { purchaseOrderId, orderId: po.orderId, supplierId, poNumber: poDisplayId, material, quantity },
        },
        "WHATSAPP"
      );

      if (!result.allowed) {
        this.logger.debug(`SUPPLIER_PO_RECEIVED suppressed for purchaseOrder=${purchaseOrderId} supplier=${supplierId}: reason=${result.reason}`);
      } else if (!result.sendResult?.success) {
        this.logger.warn(
          `SUPPLIER_PO_RECEIVED WhatsApp send failed for purchaseOrder=${purchaseOrderId} supplier=${supplierId}: ${result.sendResult?.error ?? "unknown error"}`
        );
      }
    } catch (error) {
      this.logger.warn(
        `SUPPLIER_PO_RECEIVED notification failed for purchaseOrder=${purchaseOrderId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
