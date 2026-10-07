// apps/supplier/lib/order-display.ts
//
// S15 — canonical supplier-facing Order reference rule.
//
// `Order.id` (the Prisma cuid primary key) must never be shown to a
// supplier as the order's business/reference number — it remains purely
// an internal identifier for route params, database lookups, API calls,
// and React keys (see apps/supplier/lib/supplier-data.ts and every page
// under apps/supplier/app/(supplier)/orders).
//
// `Order.orderNumber` (format "OD/YYMM/SSSSS") and `Order.enquiryId`
// (format "EQ/YYMM/SSSSS", or a legacy "<CODE>-<CODE>-<SEQUENCE>" value
// for pre-migration orders) are the two existing business identifiers —
// see packages/db/lib/business-number.ts for how they are generated.
// This module does NOT generate, invent, or change either value; it only
// decides which of the two already-existing values a supplier should see,
// so every supplier surface (order list, order detail, dashboard queue,
// detail modal, PO-linked-order reference) renders the exact same label
// for the exact same Order.
//
// `orderNumber` is generated lazily (at payment approval / the supplier's
// own PLACED -> PROCESSING transition — see
// apps/api/src/admin/payments/payments.service.ts and
// apps/api/src/supplier/orders/orders.service.ts), so it is frequently
// still null for an order awaiting that stage. `enquiryId` exists from
// the moment the order/enquiry is created and is therefore always the
// correct fallback. If an order somehow has neither value set, a neutral
// placeholder is shown — never the internal cuid, and never a
// newly-invented business number.
export const NO_ORDER_REFERENCE_LABEL = "Reference pending";

export type OrderReferenceInput = {
  orderNumber?: string | null;
  enquiryId?: string | null;
};

/**
 * Resolves the single, canonical supplier-facing label for an Order:
 *   orderNumber ?? enquiryId ?? NO_ORDER_REFERENCE_LABEL
 *
 * Never falls back to `Order.id`.
 */
export function resolveSupplierOrderReference(order: OrderReferenceInput): string {
  return order.orderNumber ?? order.enquiryId ?? NO_ORDER_REFERENCE_LABEL;
}
