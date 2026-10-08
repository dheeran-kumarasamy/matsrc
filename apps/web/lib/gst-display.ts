// C29 — GST visibility earlier in the shopping journey (PLP / PDP / Quick
// View / Enquiry panel / Cart), without introducing a second, independently
// computed GST figure.
//
// EXISTING ARCHITECTURE (investigated, unchanged by this module):
// - Every price shown before Cart/Checkout (PLP "Starting from ₹X", PDP
//   "Base price", pricing tiers) is GST-EXCLUSIVE. GST is added on top only
//   at Cart/Checkout (apps/web/app/(builder)/cart/page.tsx,
//   apps/web/components/cart/CartDrawer.tsx,
//   apps/web/app/(builder)/checkout/page.tsx) and again, authoritatively,
//   server-side at order creation / invoicing
//   (packages/db/lib/gst-calculation.ts, apps/web/lib/site-wise-report.ts,
//   apps/web/lib/tally-vouchers.ts).
// - Product/OrderItem have no customer-facing, per-product GST rate wired
//   into the public listings API today: Product carries no gstRatePct
//   column, and OrderItem.taxRatePercent (the only per-line GST-rate field
//   that exists) is never populated by the cart -> checkout order-creation
//   pipeline (apps/web/lib/order-checkout.ts creates every OrderItem
//   without a taxRatePercent). Every order therefore always falls back to
//   the shared DEFAULT_TAX_RATE_PERCENT convention already used across this
//   codebase (packages/db/lib/gst-calculation.ts,
//   apps/web/lib/sourcing/landed-cost.ts, apps/web/lib/site-wise-report.ts,
//   apps/web/lib/tally-vouchers.ts) — the exact same 18% already
//   hard-coded (as a bare `0.18` literal) into Cart, CartDrawer and
//   Checkout.
// - This module does NOT fabricate a number and does NOT introduce a new
//   GST calculation: it exposes that SAME 18% platform default (previously
//   duplicated as a literal in three separate cart/checkout components) as
//   one shared constant + small pure formatting helpers, so the pre-cart
//   browsing stages can truthfully disclose the identical GST treatment the
//   authoritative cart/checkout screens already compute — just earlier in
//   the journey. Cart/Checkout's own totals are unchanged by this module;
//   they now simply import the same constant instead of repeating it.
//
// Multi-supplier note (S12): every listing reachable from the public
// listings API resolves to this one platform-wide default today (no
// supplier/category override path exists in the live order-creation
// pipeline), so stating "18%" uniformly is not an arbitrary merge of
// different suppliers' rates — it is the one real rate currently in
// effect for all of them. If/when a genuine per-supplier/category GST
// rate is wired into the public listings response, this module's callers
// must be updated to read that per-listing value instead (tracked
// separately — see S10 GST/KYC backlog item, out of scope for C29).
//
// No schema change. No database access. Pure, framework-free formatting
// layer only — mirrors the existing convention established by
// apps/web/lib/product-price-display.ts.

/**
 * Mirrors packages/db/lib/gst-calculation.ts's DEFAULT_TAX_RATE_PERCENT —
 * the single platform-wide GST rate every cart/checkout screen already
 * applies (every product reachable from the public listings API resolves
 * to this rate today; see doc comment above).
 */
export const DEFAULT_TAX_RATE_PERCENT = 18;

/**
 * Estimates the GST amount for a GST-exclusive rupee amount, using the
 * exact same rounding Cart/Checkout already apply
 * (`Math.round(amount * 0.18)`) — kept byte-for-byte equivalent so this
 * never produces a number that disagrees with the authoritative
 * cart/checkout total. Returns 0 for a non-finite or non-positive amount
 * (never a negative or fabricated figure).
 */
export function estimateGstAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount * DEFAULT_TAX_RATE_PERCENT) / 100);
}

/**
 * Estimated GST-inclusive total for a GST-exclusive rupee amount — same
 * `amount + estimateGstAmount(amount)` shape Cart/Checkout already compute.
 */
export function estimateGstInclusiveTotal(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount + estimateGstAmount(amount);
}

/**
 * Compact pre-cart disclosure for a GST-exclusive unit price — e.g. for
 * the PLP product card, where showing a specific rupee GST amount could
 * wrongly imply a single supplier/tier total (REQ: "Starting from ₹Xxx" is
 * the minimum across ALL suppliers/tiers). The rate itself is still
 * accurate and uniform across every listing (see doc comment above), so
 * disclosing it is not a fabrication — only an absolute rupee amount would
 * be.
 */
export function formatGstExclusiveNote(): string {
  return `+ GST (${DEFAULT_TAX_RATE_PERCENT}%)`;
}

/**
 * Label for the Cart/Checkout GST line item — kept here so the rate shown
 * is always driven by the single shared constant above rather than a
 * second hard-coded literal.
 */
export function formatGstLineLabel(): string {
  return `GST (${DEFAULT_TAX_RATE_PERCENT}%)`;
}
