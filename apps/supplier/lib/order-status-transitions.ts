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

// Human-readable read-only status shown in place of action buttons once no
// further supplier action is available (terminal states, or any status not
// covered above — e.g. a future status added to the enum that this table
// hasn't been taught about yet, which we treat conservatively as read-only
// rather than exposing a possibly-invalid action).
export function getReadOnlyStatusLabel(status: OrderStatus): string | null {
  if (status === "DELIVERED") return "Order Delivered";
  // CANCELLED covers both a direct decline by this supplier and the
  // multi-supplier fan-out case where every eligible candidate declined
  // (see declineOrderForSupplier in this same lib) — from the acting
  // supplier's perspective on this page both read the same: no further
  // action is possible on a declined/cancelled enquiry.
  if (status === "CANCELLED") return "Enquiry Declined";
  if (getAvailableActions(status).length === 0) return `Order status: ${status}`;
  return null;
}
