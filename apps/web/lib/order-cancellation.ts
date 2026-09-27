// Single source of truth for whether a BUILDER (as opposed to the supplier)
// may cancel a given order, used by:
//   - app/api/builder/orders/[id]/cancel/route.ts (server-side enforcement)
//   - components/orders/PurchaseOrderApprovalCard.tsx (gates the "Cancel
//     Order" button so it is never shown for an order that would be
//     rejected anyway)
//
// This mirrors — and does NOT introduce a new/competing policy alongside —
// the existing PLACED -> CANCELLED supplier-decline transition already
// established in apps/supplier/lib/order-status-transitions.ts and the
// equivalent VALID_SUPPLIER_TRANSITIONS table in
// apps/api/src/supplier/orders/orders.service.ts: once a supplier has
// confirmed the enquiry (PROCESSING) or it has moved further
// (DISPATCHED/OUT_FOR_DELIVERY/DELIVERED), or the order is already
// CANCELLED, cancellation is no longer available. Kept framework-agnostic
// (no Next/Prisma imports) so it's directly unit-testable without a DOM/
// Prisma test harness — see apps/web/vitest.config.ts (environment: "node").
export type OrderStatus = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

const BUILDER_CANCELLABLE_STATUSES: readonly OrderStatus[] = ["PLACED"];

export function isBuilderCancellableOrderStatus(status: OrderStatus): boolean {
  return BUILDER_CANCELLABLE_STATUSES.includes(status);
}

// Human-readable reason surfaced by the cancel API when a cancellation
// attempt is rejected because of the order's current status.
export function builderCancellationRejectionReason(status: OrderStatus): string {
  if (status === "CANCELLED") {
    return "This order is already cancelled";
  }
  return "This order can no longer be cancelled — it has already moved past the stage where cancellation is allowed";
}
