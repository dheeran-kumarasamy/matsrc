// Single source of truth for which supplier-facing action(s) are valid for a
// given Order.status, and what OrderStatus each action transitions the order
// to. Mirrors the production `OrderStatus` enum in
// packages/db/prisma/schema.prisma (PLACED/PROCESSING/DISPATCHED/
// OUT_FOR_DELIVERY/DELIVERED/CANCELLED) — no parallel status system is
// introduced here, this only expresses which *transitions* between those
// existing statuses a supplier may trigger from the order detail page.
//
// Deliberately framework-agnostic (no Next/React/Prisma imports) so it can be
// safely imported from both:
//   - the "use client" OrderStatusActions component (buttons shown/hidden)
//   - server-side code (lib/supplier-data.ts) that must reject an invalid
//     transition even if a request is made directly against the API,
//     bypassing the UI entirely.
export type OrderStatus = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

export type OrderActionKey = "CONFIRM" | "DECLINE" | "DISPATCH" | "DELIVER";

export type OrderAction = {
  key: OrderActionKey;
  label: string;
  nextStatus: OrderStatus;
};

// The only transitions a supplier can trigger from the order detail page's
// action buttons, keyed by the order's *current* status:
//   PLACED            (awaiting supplier response) -> PROCESSING | CANCELLED
//   PROCESSING        (accepted, awaiting dispatch) -> DISPATCHED
//   DISPATCHED        (in transit)                  -> DELIVERED
//   OUT_FOR_DELIVERY   (in transit, later stage)      -> DELIVERED
//   DELIVERED / CANCELLED are terminal — no further supplier action.
const NEXT_ACTIONS: Record<OrderStatus, OrderAction[]> = {
  PLACED: [
    { key: "CONFIRM", label: "Confirm Enquiry", nextStatus: "PROCESSING" },
    { key: "DECLINE", label: "Decline Enquiry", nextStatus: "CANCELLED" },
  ],
  PROCESSING: [{ key: "DISPATCH", label: "Mark Dispatched", nextStatus: "DISPATCHED" }],
  DISPATCHED: [{ key: "DELIVER", label: "Mark Delivered", nextStatus: "DELIVERED" }],
  OUT_FOR_DELIVERY: [{ key: "DELIVER", label: "Mark Delivered", nextStatus: "DELIVERED" }],
  DELIVERED: [],
  CANCELLED: [],
};

export function getAvailableActions(status: OrderStatus): OrderAction[] {
  return NEXT_ACTIONS[status] ?? [];
}

export function isValidOrderStatusTransition(current: OrderStatus, next: OrderStatus): boolean {
  return (NEXT_ACTIONS[current] ?? []).some((action) => action.nextStatus === next);
}

// Minimal shape of a persisted OrderTracking row needed to distinguish WHO
// cancelled a CANCELLED order — the builder (via the existing
// POST /api/builder/orders/[id]/cancel action) or the supplier (via
// "Decline Enquiry" / the multi-supplier fan-out cascade in
// declineOrderForSupplier, both in this app's lib/supplier-data.ts). Deliberately
// generic over "note" (rather than requiring the full SupplierTrackingStep
// shape) so callers can pass either the raw OrderTracking.note or the
// already-humanized `label` field (which mirrors note verbatim whenever a
// note was recorded — see getSupplierOrderDetail's `label: entry.note ??
// humanizeToken(entry.status)`). No new database field is introduced —
// this reuses the note text already being persisted by every code path that
// cancels an order.
export type TrackingEntryLike = { status: OrderStatus; note?: string | null };

export type CancellationActor = "BUILDER" | "SUPPLIER" | "UNKNOWN";

// Inspects the most recent CANCELLED tracking entry's note to determine who
// cancelled the order. Every existing cancellation code path already writes
// a distinguishing note:
//   - builder-initiated: "Cancelled by builder"
//     (apps/web/app/api/builder/orders/[id]/cancel/route.ts) or
//     "Builder opted out of aggregation pool" (aggregation opt-out)
//   - supplier-initiated: "All eligible suppliers declined this enquiry" or
//     the legacy fallback "Supplier marked order as cancelled"
//     (apps/supplier/lib/supplier-data.ts / apps/api's mirrored service)
// `tracking` is expected ordered ascending by recordedAt (as every existing
// query already does, e.g. `orderBy: { recordedAt: "asc" }` in
// getSupplierOrderDetail) so the LAST matching entry is the most recent one.
// A legacy/unknown record (no matching keyword, or no CANCELLED entry at
// all) is never guessed — it resolves to "UNKNOWN" rather than being
// misattributed to either actor.
export function getCancellationActor(tracking: TrackingEntryLike[]): CancellationActor {
  for (let i = tracking.length - 1; i >= 0; i--) {
    const entry = tracking[i];
    if (entry.status !== "CANCELLED") continue;
    const note = (entry.note ?? "").toLowerCase();
    if (note.includes("builder")) return "BUILDER";
    if (note.includes("supplier") || note.includes("declined")) return "SUPPLIER";
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

// Human-readable read-only status shown in place of action buttons once no
// further supplier action is available (terminal states, or any status not
// covered above — e.g. a future status added to the enum that this table
// hasn't been taught about yet, which we treat conservatively as read-only
// rather than exposing a possibly-invalid action).
//
// `tracking` is optional (defaults to empty) so existing callers that don't
// have it handy still get a safe, non-misleading label for CANCELLED
// ("Cancelled") rather than a compile error.
export function getReadOnlyStatusLabel(status: OrderStatus, tracking: TrackingEntryLike[] = []): string | null {
  if (status === "DELIVERED") return "Order Delivered";
  if (status === "CANCELLED") {
    const actor = getCancellationActor(tracking);
    if (actor === "BUILDER") return "Cancelled by Builder";
    if (actor === "SUPPLIER") return "Declined by Supplier";
    // Legacy/unknown-actor cancellation — never guess, use the safe generic.
    return "Cancelled";
  }
  if (getAvailableActions(status).length === 0) return `Order status: ${status}`;
  return null;
}
