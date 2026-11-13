// Single source of truth for the builder/customer-facing "Order Confirmed
// Successfully" copy, plus the pure query-param resolution logic used by
// app/(builder)/orders/page.tsx to decide whether to show it. Kept
// framework-agnostic (no React/Next imports) so both the message content
// and the "when to show it" logic are directly unit-testable without a
// DOM/rendering environment (this repo has no jsdom/testing-library setup
// — see apps/web/vitest.config.ts, environment: "node").
//
// Used by:
//   - components/orders/OrderConfirmationBanner.tsx (default description)
//   - app/(builder)/orders/page.tsx (resolveConfirmedReferences)
//   - app/(builder)/checkout/page.tsx, app/(builder)/cart/page.tsx
//     (buildConfirmedOrdersUrl)

export const ORDER_CONFIRMATION_TITLE = "Order Confirmed Successfully";

export const ORDER_CONFIRMATION_MESSAGE =
  "Your order has been confirmed and is now being processed. The supplier will proceed with the order, and you\u2019ll receive an update once the order is ready for the next step.";

// S12 Phase 1 — a multi-supplier checkout creates one independent Order per
// supplier (see apps/web/lib/order-checkout.ts). Previously only the FIRST
// created order's reference survived the post-checkout redirect
// (buildConfirmedOrdersUrl used orders[0] only), silently discarding every
// sibling enquiry/order reference. This type + the helpers below instead
// carry EVERY created order's business-facing reference (enquiryId, never
// the internal cuid) plus its supplier name (already present on the
// checkout response — no new API call) through to the confirmation UI.
export type ConfirmedOrderSummary = {
  // Business-facing reference only — enquiryId (falls back to the raw
  // order id ONLY for pre-migration orders that predate the enquiryId
  // column, mirroring the existing fallback convention used everywhere
  // else this value is displayed, e.g. apps/web/app/api/builder/orders/
  // route.ts's `enquiryId: order.enquiryId ?? order.id`). Internal cuids
  // are never treated as a "new" identifier here — this is purely
  // preserving the exact same fallback the rest of the app already uses.
  reference: string;
  // Optional — omitted (not a placeholder string) when the caller's
  // response doesn't carry it, so the UI can simply skip the supplier
  // label rather than render "undefined"/"null".
  supplierName?: string;
};

// Resolves the ?confirmed=<reference1>,<reference2>,... query param (set
// only by app/(builder)/checkout/page.tsx and app/(builder)/cart/page.tsx
// immediately after their own POST /orders/checkout call has already
// resolved successfully) into an ordered list of confirmed order
// references, or an empty array if absent. Never derives a "confirmed"
// state from anything else — in particular, merely visiting /orders (with
// no query param) for an order that happens to already be confirmed must
// NOT show this banner.
export function resolveConfirmedReferences(searchParams: {
  confirmed?: string | string[];
}): string[] {
  const value = Array.isArray(searchParams.confirmed) ? searchParams.confirmed[0] : searchParams.confirmed;
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// Back-compat single-reference accessor — returns only the first confirmed
// reference, or null if none.
export function resolveConfirmedReference(searchParams: {
  confirmed?: string | string[];
}): string | null {
  const [first] = resolveConfirmedReferences(searchParams);
  return first ?? null;
}

// Builds the /orders redirect target used by app/(builder)/checkout/page.tsx
// and app/(builder)/cart/page.tsx immediately after a successful
// POST /orders/checkout response, carrying EVERY created order's
// human-readable enquiry ID (falling back to the raw order id for
// pre-migration orders) through as ?confirmed=<ref1>,<ref2>,... so the
// "Order Confirmed Successfully" banner can display all of them on
// /orders — never silently discarding sibling Order references from a
// multi-supplier checkout. Called ONLY from the success branch of that
// POST — never from a catch block — so an unsuccessful confirmation can
// never produce this URL.
export function buildConfirmedOrdersUrl(
  checkoutResponse: { orders?: Array<{ enquiryId?: string | null; id: string }> } | null | undefined
): string {
  const references = (checkoutResponse?.orders ?? [])
    .map((order) => order.enquiryId ?? order.id ?? "")
    .filter((reference) => reference.length > 0);
  if (references.length === 0) return "/orders";
  return `/orders?confirmed=${references.map((reference) => encodeURIComponent(reference)).join(",")}`;
}

// Same-render handoff for CartDrawer's inline "success" wizard step, which
// never does a URL redirect at all (it stays on the overlay) — so unlike
// buildConfirmedOrdersUrl() above, supplier names ARE available and ARE
// preserved here (no URL-encoding/query-string-size constraint).
export function buildConfirmedOrderSummaries(
  checkoutResponse:
    | { orders?: Array<{ enquiryId?: string | null; id: string; supplierName?: string | null }> }
    | null
    | undefined
): ConfirmedOrderSummary[] {
  return (checkoutResponse?.orders ?? [])
    .map((order) => ({
      reference: order.enquiryId ?? order.id ?? "",
      supplierName: order.supplierName ?? undefined,
    }))
    .filter((summary) => summary.reference.length > 0);
}
