"use client";

// Shared "Order Confirmed Successfully" confirmation message — shown ONLY
// after the backend has definitively completed a confirmation action for an
// order/enquiry (never merely because a button was clicked). Reused across
// every surface that confirms an order so the copy, styling, and "what
// happens next" messaging stay consistent site-wide:
//
//   - components/cart/CartDrawer.tsx        (builder submits an enquiry —
//     the "success" wizard step, after POST /orders/checkout resolves)
//   - app/(builder)/orders/page.tsx          (the standalone /checkout and
//     /cart pages redirect here with ?confirmed=<ref1>,<ref2>,... after
//     their own successful POST /orders/checkout)
//   - components/supplier/OrderStatusActions.tsx (supplier clicks "Confirm
//     Enquiry" — PLACED -> PROCESSING — after the PATCH succeeds)
//
// S12 Phase 1: a multi-supplier checkout creates one independent Order per
// supplier (see apps/web/lib/order-checkout.ts) — there is no persisted
// "checkout group" entity and none is introduced here. This banner must
// therefore be able to list EVERY created enquiry/order reference, not just
// the first, and must never describe them as a "Group Order" (that term is
// reserved for the existing, unrelated Group & Save / aggregation feature —
// see app/(builder)/group-orders/page.tsx). Instead it explains plainly
// that the cart was split across suppliers into separate enquiries.
//
// Visually distinct from the existing error/warning treatment (which uses
// posh-primary/rose tones elsewhere in this app) via the same emerald
// success colour already used by CartDrawer's existing checkmark icon —
// no new colours introduced. Built entirely from existing posh-* tokens/
// classes (posh-card, posh-card-title, posh-subtitle) and lucide-react
// (already a dependency) — no new dependency.
import { CheckCircle2 } from "lucide-react";
import { ORDER_CONFIRMATION_TITLE, ORDER_CONFIRMATION_MESSAGE, type ConfirmedOrderSummary } from "@/lib/order-confirmation";

type OrderConfirmationBannerProps = {
  // The human-readable enquiry ID (e.g. "ABC-SITE01-000123") or, for
  // pre-migration orders, the raw order id — whatever the caller already
  // displays elsewhere for this order. Optional: some callers may not have
  // it on hand (e.g. a generic supplier confirmation), in which case the
  // "Order:" line is simply omitted rather than showing a placeholder.
  //
  // Mutually exclusive with `orders` below — pass exactly one. Kept for
  // backward compatibility with existing single-reference callers
  // (components/supplier/OrderStatusActions.tsx).
  enquiryId?: string | null;
  // S12 Phase 1 — every enquiry/order reference created by a single
  // checkout (one per supplier). When this has more than one entry the
  // banner explicitly communicates that the cart was split across
  // suppliers, and lists every reference — never silently showing only
  // the first one.
  orders?: ConfirmedOrderSummary[];
  // Perspective-specific detail line. Defaults to the builder/customer
  // wording from the product spec. Supplier-side callers pass their own
  // copy (see OrderStatusActions.tsx) since "the supplier will proceed"
  // doesn't make sense once the supplier themself performed the action.
  description?: string;
};

export default function OrderConfirmationBanner({
  enquiryId,
  orders,
  description = ORDER_CONFIRMATION_MESSAGE,
}: OrderConfirmationBannerProps) {
  const summaries: ConfirmedOrderSummary[] =
    orders && orders.length > 0 ? orders : enquiryId ? [{ reference: enquiryId }] : [];
  const isMultiSupplier = summaries.length > 1;

  return (
    <div
      role="status"
      className="posh-card flex flex-col items-center gap-3 p-6 text-center"
      style={{ borderColor: "var(--posh-border)" }}
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80" }}
      >
        <CheckCircle2 size={28} />
      </div>
      <p className="posh-card-title">{ORDER_CONFIRMATION_TITLE}</p>
      <p className="posh-subtitle max-w-md">{description}</p>

      {isMultiSupplier ? (
        <div className="w-full max-w-md space-y-2 text-left">
          {/* S12 Phase 1: explicit "split across suppliers" wording — never
              "Group Order", which is reserved for Group & Save. */}
          <p className="text-sm font-semibold" style={{ color: "var(--posh-fg)" }}>
            Your cart was split across {summaries.length} suppliers. Separate enquiries were created for each:
          </p>
          <ul className="space-y-1">
            {summaries.map((summary) => (
              <li
                key={summary.reference}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--posh-border)" }}
              >
                <span className="font-bold" style={{ color: "var(--posh-fg)" }}>
                  {summary.reference}
                </span>
                {summary.supplierName ? (
                  <span className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>
                    {summary.supplierName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : summaries[0] ? (
        <p className="mt-1 text-sm font-semibold" style={{ color: "var(--posh-fg)" }}>
          Order: <span className="font-bold">{summaries[0].reference}</span>
        </p>
      ) : null}
    </div>
  );
}

