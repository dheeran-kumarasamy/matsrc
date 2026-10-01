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

// Lightweight builder-cancellation reason mechanism (no existing one was
// found in the codebase — see the search that preceded this addition: no
// `cancellationReason`/`declineReason` field/enum exists anywhere). This is
// intentionally NOT a new database column: the chosen reason is folded into
// the existing OrderTracking.note free-text field already written by
// app/api/builder/orders/[id]/cancel/route.ts, so no schema migration is
// required and the existing "Cancelled by builder" audit convention (relied
// on by apps/supplier/lib/order-status-transitions.ts's getCancellationActor,
// which keys off the substring "builder") is preserved unconditionally.
export type CancellationReasonKey =
  | "QUANTITY_CHANGED"
  | "NO_LONGER_REQUIRED"
  | "CREATED_NEW_ENQUIRY"
  | "OTHER";

export const CANCELLATION_REASONS: ReadonlyArray<{ key: CancellationReasonKey; label: string }> = [
  { key: "QUANTITY_CHANGED", label: "Quantity changed" },
  { key: "NO_LONGER_REQUIRED", label: "No longer required" },
  { key: "CREATED_NEW_ENQUIRY", label: "Created a new enquiry" },
  { key: "OTHER", label: "Other" },
];

const CANCELLATION_REASON_LABELS: Record<CancellationReasonKey, string> = CANCELLATION_REASONS.reduce(
  (acc, r) => ({ ...acc, [r.key]: r.label }),
  {} as Record<CancellationReasonKey, string>
);

export function isCancellationReasonKey(value: unknown): value is CancellationReasonKey {
  return typeof value === "string" && value in CANCELLATION_REASON_LABELS;
}

// Builds the OrderTracking.note text persisted for a builder-initiated
// cancellation. ALWAYS contains the substring "builder" (case-insensitively)
// so getCancellationActor() in apps/supplier/lib/order-status-transitions.ts
// continues to correctly attribute the cancellation, whether or not a reason
// was supplied — the pre-existing "Cancelled by builder" baseline is the
// fallback when no (or an unrecognised) reason is given.
export function formatBuilderCancellationNote(
  reasonKey: CancellationReasonKey | null,
  otherDetail?: string | null
): string {
  if (!reasonKey) {
    return "Cancelled by builder";
  }
  const label = CANCELLATION_REASON_LABELS[reasonKey];
  const trimmedDetail = (otherDetail ?? "").trim().slice(0, 200);
  const suffix = reasonKey === "OTHER" && trimmedDetail ? `: ${trimmedDetail}` : "";
  return `Cancelled by builder — Reason: ${label}${suffix}`;
}
