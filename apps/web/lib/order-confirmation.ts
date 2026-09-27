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
//   - app/(builder)/orders/page.tsx (resolveConfirmedReference)

export const ORDER_CONFIRMATION_TITLE = "Order Confirmed Successfully";

export const ORDER_CONFIRMATION_MESSAGE =
  "Your order has been confirmed and is now being processed. The supplier will proceed with the order, and you\u2019ll receive an update once the order is ready for the next step.";

// Resolves the ?confirmed=<enquiryId> query param (set only by
// app/(builder)/checkout/page.tsx and app/(builder)/cart/page.tsx
// immediately after their own POST /orders/checkout call has already
// resolved successfully) into a single string reference, or null if absent.
// Never derives a "confirmed" state from anything else — in particular,
// merely visiting /orders (with no query param) for an order that happens
// to already be confirmed must NOT show this banner.
export function resolveConfirmedReference(searchParams: {
  confirmed?: string | string[];
}): string | null {
  const value = Array.isArray(searchParams.confirmed) ? searchParams.confirmed[0] : searchParams.confirmed;
  return typeof value === "string" && value.trim() ? value : null;
}

// Builds the /orders redirect target used by app/(builder)/checkout/page.tsx
// and app/(builder)/cart/page.tsx immediately after a successful
// POST /orders/checkout response, carrying the confirmed order's
// human-readable enquiry ID (falling back to the raw order id for
// pre-migration orders) through as ?confirmed=<reference> so the
// "Order Confirmed Successfully" banner can display it on /orders. Called
// ONLY from the success branch of that POST — never from a catch block —
// so an unsuccessful confirmation can never produce this URL.
export function buildConfirmedOrdersUrl(
  checkoutResponse: { orders?: Array<{ enquiryId?: string | null; id: string }> } | null | undefined
): string {
  const reference = checkoutResponse?.orders?.[0]?.enquiryId ?? checkoutResponse?.orders?.[0]?.id ?? "";
  return `/orders${reference ? `?confirmed=${encodeURIComponent(reference)}` : ""}`;
}
