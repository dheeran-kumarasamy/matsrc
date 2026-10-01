// PLP product-card price display (product-listing price display change).
//
// Requirement: the /products listing card must show a single
// "Starting from ₹Xxx" price — the minimum VALID price across ALL suppliers
// offering the product AND ALL of their price tiers (see
// apps/supplier/lib/resolution.ts `resolveMinimumDisplayPrice()`, which is
// the actual cross-supplier/cross-tier minimum computation reused here) —
// never a min–max range, and never a fabricated ₹0 when no valid price
// exists.
//
// This module is intentionally a thin, pure, framework-free formatting layer
// (no duplicate pricing logic) so ProductCard.tsx stays a dumb renderer and
// the min-price decision itself stays unit-testable without React.

/**
 * Decides the exact "Starting from ₹Xxx" price to display for a PLP product
 * card, given the listing's already-computed `startingPrice` (the
 * cross-supplier/cross-tier minimum from the server) and legacy `price`
 * field as a fallback for listings from a data source that hasn't been
 * updated to populate `startingPrice` yet.
 *
 * Returns null when there is no valid (finite, strictly positive) price to
 * show — callers must render the existing empty/unavailable-price state in
 * that case, never ₹0 or any invented value.
 */
export function resolveStartingDisplayPrice(input: {
  startingPrice?: number | null;
  price?: number | null;
}): number | null {
  if (typeof input.startingPrice === "number" && Number.isFinite(input.startingPrice) && input.startingPrice > 0) {
    return input.startingPrice;
  }

  if (typeof input.price === "number" && Number.isFinite(input.price) && input.price > 0) {
    return input.price;
  }

  return null;
}

/** Formats a validated display price as "₹Xxx" using en-IN grouping. */
export function formatStartingPriceLabel(price: number): string {
  return `₹${price.toLocaleString("en-IN")}`;
}
