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
//     /cart pages redirect here with ?confirmed=<enquiryId> after their own
//     successful POST /orders/checkout)
//   - components/supplier/OrderStatusActions.tsx (supplier clicks "Confirm
//     Enquiry" — PLACED -> PROCESSING — after the PATCH succeeds)
//
// Visually distinct from the existing error/warning treatment (which uses
// posh-primary/rose tones elsewhere in this app) via the same emerald
// success colour already used by CartDrawer's existing checkmark icon —
// no new colours introduced. Built entirely from existing posh-* tokens/
// classes (posh-card, posh-card-title, posh-subtitle) and lucide-react
// (already a dependency) — no new dependency.
import { CheckCircle2 } from "lucide-react";
import { ORDER_CONFIRMATION_TITLE, ORDER_CONFIRMATION_MESSAGE } from "@/lib/order-confirmation";

type OrderConfirmationBannerProps = {
  // The human-readable enquiry ID (e.g. "ABC-SITE01-000123") or, for
  // pre-migration orders, the raw order id — whatever the caller already
  // displays elsewhere for this order. Optional: some callers may not have
  // it on hand (e.g. a generic supplier confirmation), in which case the
  // "Order:" line is simply omitted rather than showing a placeholder.
  enquiryId?: string | null;
  // Perspective-specific detail line. Defaults to the builder/customer
  // wording from the product spec. Supplier-side callers pass their own
  // copy (see OrderStatusActions.tsx) since "the supplier will proceed"
  // doesn't make sense once the supplier themself performed the action.
  description?: string;
};

export default function OrderConfirmationBanner({
  enquiryId,
  description = ORDER_CONFIRMATION_MESSAGE,
}: OrderConfirmationBannerProps) {
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
      {enquiryId ? (
        <p className="mt-1 text-sm font-semibold" style={{ color: "var(--posh-fg)" }}>
          Order: <span className="font-bold">{enquiryId}</span>
        </p>
      ) : null}
    </div>
  );
}
