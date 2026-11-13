// packages/db/lib/order-buyer-confirmation.ts
//
// Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
// Dispatch — shared, framework-agnostic derivation of:
//   1. the buyer-facing confirmation state (NEVER persisted — always
//      computed fresh from Order.status + SupplierInvoice.status, exactly
//      like the existing `paymentLinkAvailable` derivation convention
//      already used by apps/web/app/api/builder/orders/route.ts), and
//   2. the authoritative final payable amount a buyer must settle before
//      an order may ever be dispatched.
//
// WHY A NEW DERIVED STATE, NOT A NEW Order.status VALUE:
// Order.status (PLACED/PROCESSING/DISPATCHED/OUT_FOR_DELIVERY/DELIVERED/
// CANCELLED) already drives purchase-order generation eligibility
// (quoteSelectionCompletedAt), the GST/markup confirmation snapshot freeze
// (order-confirmation-snapshot.ts), and multiple independent WhatsApp
// notification pipelines (customer_order_status, payment_required) — see
// this module's own callers for the full audit. Re-purposing PROCESSING's
// meaning, or inserting a new enum value between PLACED and PROCESSING,
// would require touching every one of those call sites and is far riskier
// than deriving a SEPARATE, buyer-facing-only label that supplier-side
// code never sees or reacts to.
//
// WHY THE FINAL PAYABLE AMOUNT IS NOT JUST Order.finalPayableAmount:
// Order.finalPayableAmount/taxAmount are FROZEN the moment the supplier
// accepts the enquiry (PLACED -> PROCESSING) — BEFORE any admin has ever
// looked at freight/other charges on the SupplierInvoice (see
// order-confirmation-snapshot.ts). Once an Admin has reviewed and
// CONFIRMED the SupplierInvoice, SupplierInvoice.confirmedTotalAmount is
// the admin-verified, freight/other-charges/discount/rounding-inclusive
// figure the buyer must actually settle (see
// supplier-invoice-reconciliation.ts's aggregateSupplierInvoiceTotals) —
// this is a STRICTLY LATER, more-accurate snapshot than the pre-confirmation
// Order-level one, never a conflicting/parallel source of truth. Before
// confirmation, there is nothing more accurate to show yet, so the
// pre-confirmation Order.finalPayableAmount/totalAmount estimate remains
// the best-available figure.

export type BuyerOrderStatus = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
export type SupplierInvoiceStatusValue = "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";

/**
 * The buyer-facing confirmation label — a PURE presentation-layer value,
 * never written to any column, never read by any supplier/admin-side
 * business logic. Exactly one of:
 *   - "NOT_YET_CONFIRMED": order is still PLACED (awaiting the supplier's
 *     own accept/decline decision) — unchanged from today's behaviour.
 *   - "AWAITING_FINAL_CONFIRMATION": the supplier has accepted
 *     (status is past PLACED) but an Admin has not yet reviewed AND
 *     confirmed the SupplierInvoice's freight/other charges. This is the
 *     NEW state this feature introduces — previously such an order was
 *     shown to the buyer as unconditionally "Confirmed"/"Processing".
 *   - "CONFIRMED": the supplier has accepted AND an Admin has confirmed
 *     the SupplierInvoice. The buyer may now see the final payable amount
 *     and pay it.
 *   - "CANCELLED": terminal — a cancelled order is NEVER shown as
 *     confirmed, regardless of any SupplierInvoice state.
 */
export type BuyerConfirmationState = "NOT_YET_CONFIRMED" | "AWAITING_FINAL_CONFIRMATION" | "CONFIRMED" | "CANCELLED";

export type SupplierInvoiceSnapshotForConfirmation = {
  status: SupplierInvoiceStatusValue;
} | null;

/**
 * Pure derivation — no I/O. `order.status is not PLACED or CANCELLED, AND
 * supplierInvoice.status === CONFIRMED` is the "CONFIRMED" condition from
 * the feature spec; every other reachable combination maps to one of the
 * three remaining states below. CANCELLED always wins over every other
 * input (a cancelled order is never shown as confirmed or pending
 * confirmation — it is simply cancelled).
 */
export function resolveBuyerConfirmationState(
  orderStatus: BuyerOrderStatus,
  supplierInvoice: SupplierInvoiceSnapshotForConfirmation
): BuyerConfirmationState {
  if (orderStatus === "CANCELLED") {
    return "CANCELLED";
  }
  if (orderStatus === "PLACED") {
    return "NOT_YET_CONFIRMED";
  }
  // Supplier has accepted (status is PROCESSING or later). Buyer
  // confirmation additionally requires an Admin-confirmed SupplierInvoice.
  if (supplierInvoice && supplierInvoice.status === "CONFIRMED") {
    return "CONFIRMED";
  }
  // Legacy/in-flight order compatibility policy — narrow, explicit
  // grandfathering: an order that has ALREADY moved past DISPATCHED
  // (i.e. DISPATCHED/OUT_FOR_DELIVERY/DELIVERED) could only have reached
  // that stage either (a) before this feature existed at all (no
  // SupplierInvoice concept/gate applied to it), or (b) via the dispatch
  // gate itself (checkOrderDispatchEligibility — see
  // order-dispatch-eligibility.ts), which NEVER allows PROCESSING ->
  // DISPATCHED without a CONFIRMED SupplierInvoice going forward. Either
  // way, by the time an order has genuinely shipped, showing the buyer
  // "Awaiting Final Confirmation" would be actively misleading (the order
  // already left the warehouse) and would permanently strand every
  // pre-feature order with no SupplierInvoice in a confusing pending
  // state forever. This is a presentation-only exception — it does NOT
  // waive or bypass the dispatch gate itself, which independently governs
  // whether a NEW PROCESSING -> DISPATCHED transition may ever occur.
  if (orderStatus === "DISPATCHED" || orderStatus === "OUT_FOR_DELIVERY" || orderStatus === "DELIVERED") {
    return "CONFIRMED";
  }
  return "AWAITING_FINAL_CONFIRMATION";
}

/** Human-readable buyer-facing label for each BuyerConfirmationState. */
export const BUYER_CONFIRMATION_STATE_LABELS: Record<BuyerConfirmationState, string> = {
  NOT_YET_CONFIRMED: "Enquiry Sent",
  AWAITING_FINAL_CONFIRMATION: "Awaiting Final Confirmation",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

export type SupplierInvoiceSnapshotForPayable = {
  status: SupplierInvoiceStatusValue;
  /** SupplierInvoice.confirmedTotalAmount — only meaningful once status === CONFIRMED. */
  confirmedTotalAmount: number | null;
} | null;

export type OrderFinalPayableResolution = {
  /** The authoritative amount the buyer must ultimately settle. */
  amount: number;
  /**
   * true once this figure is the ADMIN-CONFIRMED, freight/other-charges-
   * inclusive final amount (SupplierInvoice.confirmedTotalAmount); false
   * while it is still the pre-confirmation estimate
   * (Order.finalPayableAmount/totalAmount) that may still change once an
   * Admin reviews the Supplier Invoice.
   */
  isFinalConfirmed: boolean;
};

/**
 * Resolves the authoritative amount a buyer must pay for an order, per
 * this module's own top doc comment: prefers the Admin-confirmed
 * SupplierInvoice total once available, falling back to the existing
 * pre-confirmation Order-level estimate otherwise. Never invents a figure
 * — a CONFIRMED SupplierInvoice with a null confirmedTotalAmount (should be
 * structurally impossible per SupplierInvoicesService.confirm()'s own
 * guard, but defended here regardless) falls back to the pre-confirmation
 * estimate rather than silently returning 0/NaN.
 */
export function resolveOrderFinalPayableAmount(
  preConfirmationEstimate: number,
  supplierInvoice: SupplierInvoiceSnapshotForPayable
): OrderFinalPayableResolution {
  if (
    supplierInvoice &&
    supplierInvoice.status === "CONFIRMED" &&
    typeof supplierInvoice.confirmedTotalAmount === "number" &&
    Number.isFinite(supplierInvoice.confirmedTotalAmount)
  ) {
    return { amount: supplierInvoice.confirmedTotalAmount, isFinalConfirmed: true };
  }
  return { amount: preConfirmationEstimate, isFinalConfirmed: false };
}
