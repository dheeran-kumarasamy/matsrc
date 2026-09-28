// Regression test for the /products "Starting from ₹X" bug, covering the
// apps/web half of the real end-to-end data path:
//
//   supplier app's /api/public/listings response (each listing already
//   carrying the server-computed `startingPrice` — see
//   apps/supplier/lib/get-public-supplier-listings-starting-price.spec.ts
//   for the upstream half of this same path)
//       -> dedupeByCanonicalGroup() (apps/web/lib/listings.ts, used by
//          app/(builder)/products/page.tsx BEFORE building card data)
//       -> resolveStartingDisplayPrice() (apps/web/lib/product-price-display.ts,
//          used by ProductCard.tsx)
//
// This proves the PLP-facing collapse-to-one-card-per-canonical-group step
// does not drop or overwrite the true cross-supplier/cross-tier minimum that
// the backend already computed.

import { describe, it, expect } from "vitest";
import { dedupeByCanonicalGroup, parseListingPrice, type SupplierListing } from "./listings";
import { resolveStartingDisplayPrice } from "./product-price-display";

// Mirrors exactly how app/(builder)/products/page.tsx builds each PLP card's
// input to resolveStartingDisplayPrice() from a deduped SupplierListing:
// `price` is the parsed numeric legacy price (fallback only), and
// `startingPrice` is passed through as-is.
function toCardPriceInput(listing: SupplierListing) {
  return {
    startingPrice: listing.startingPrice ?? undefined,
    price: parseListingPrice(listing.price),
  };
}

function makeListing(overrides: Partial<SupplierListing> & { id: string; supplierId: string }): SupplierListing {
  return {
    name: "Test Product",
    category: "TMT Steel",
    grade: "Fe500",
    unit: "KG",
    price: "₹1,000 / KG",
    stock: "1000 KG",
    maxServiceableQty: "1000 KG",
    active: true,
    pricingTiers: [],
    canonicalProductId: null,
    groupedListingIds: undefined,
    headlinePrice: undefined,
    headlineSupplierId: undefined,
    minPrice: null,
    maxPrice: null,
    startingPrice: null,
    ...overrides,
  };
}

describe("dedupeByCanonicalGroup + resolveStartingDisplayPrice (PLP end-to-end)", () => {
  it("REQUIREMENT EXAMPLE: 3 suppliers, multiple tiers each -> collapsed card displays ₹850, not a range or default-tier price", () => {
    const listings: SupplierListing[] = [
      makeListing({
        id: "p-a", supplierId: "supplier-a", canonicalProductId: "canon-1",
        groupedListingIds: ["p-a", "p-b", "p-c"], headlineSupplierId: "supplier-b",
        headlinePrice: "₹920 / KG", price: "₹1,000 / KG",
        minPrice: 850, maxPrice: 1050, startingPrice: 850,
      }),
      makeListing({
        id: "p-b", supplierId: "supplier-b", canonicalProductId: "canon-1",
        groupedListingIds: ["p-a", "p-b", "p-c"], headlineSupplierId: "supplier-b",
        headlinePrice: "₹920 / KG", price: "₹980 / KG",
        minPrice: 850, maxPrice: 1050, startingPrice: 850,
      }),
      makeListing({
        id: "p-c", supplierId: "supplier-c", canonicalProductId: "canon-1",
        groupedListingIds: ["p-a", "p-b", "p-c"], headlineSupplierId: "supplier-b",
        headlinePrice: "₹920 / KG", price: "₹1,050 / KG",
        minPrice: 850, maxPrice: 1050, startingPrice: 850,
      }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);
    expect(deduped).toHaveLength(1);
    expect(resolveStartingDisplayPrice(toCardPriceInput(deduped[0]))).toBe(850);
  });

  it("Case 3 — different supplier's non-default tier (A:1000/900, B:950/650) survives dedupe collapse -> ₹650", () => {
    const listings: SupplierListing[] = [
      makeListing({
        id: "p-a", supplierId: "supplier-a", canonicalProductId: "canon-4",
        groupedListingIds: ["p-a", "p-b"], headlineSupplierId: "supplier-b",
        headlinePrice: "₹950 / KG", price: "₹1,000 / KG", startingPrice: 650,
      }),
      makeListing({
        id: "p-b", supplierId: "supplier-b", canonicalProductId: "canon-4",
        groupedListingIds: ["p-a", "p-b"], headlineSupplierId: "supplier-b",
        headlinePrice: "₹950 / KG", price: "₹950 / KG", startingPrice: 650,
      }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);
    expect(resolveStartingDisplayPrice(toCardPriceInput(deduped[0]))).toBe(650);
  });

  it("Case 5 — multiple independent products: dedupe keeps each canonical group's own startingPrice separate", () => {
    const listings: SupplierListing[] = [
      makeListing({ id: "cement-a", supplierId: "supplier-a", canonicalProductId: "canon-cement", name: "Cement", groupedListingIds: ["cement-a", "cement-b"], startingPrice: 300 }),
      makeListing({ id: "cement-b", supplierId: "supplier-b", canonicalProductId: "canon-cement", name: "Cement", groupedListingIds: ["cement-a", "cement-b"], startingPrice: 300 }),
      makeListing({ id: "tmt-a", supplierId: "supplier-a", canonicalProductId: "canon-tmt", name: "TMT Bar", groupedListingIds: ["tmt-a", "tmt-b"], startingPrice: 55000 }),
      makeListing({ id: "tmt-b", supplierId: "supplier-b", canonicalProductId: "canon-tmt", name: "TMT Bar", groupedListingIds: ["tmt-a", "tmt-b"], startingPrice: 55000 }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);
    expect(deduped).toHaveLength(2);

    const cement = deduped.find((l) => l.name === "Cement")!;
    const tmt = deduped.find((l) => l.name === "TMT Bar")!;
    expect(resolveStartingDisplayPrice(toCardPriceInput(cement))).toBe(300);
    expect(resolveStartingDisplayPrice(toCardPriceInput(tmt))).toBe(55000);
  });

  it("Case 4 — no valid price on any group member: displays as unavailable (null), never ₹0", () => {
    const listings: SupplierListing[] = [
      makeListing({ id: "p-a", supplierId: "supplier-a", canonicalProductId: "canon-5", price: "₹0 / KG", startingPrice: null }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);
    expect(resolveStartingDisplayPrice(toCardPriceInput(deduped[0]))).toBeNull();
  });

  it("never renders a min–max range value from the deduped listing — only a single startingPrice-driven number", () => {
    const listings: SupplierListing[] = [
      makeListing({ id: "p-a", supplierId: "supplier-a", canonicalProductId: "canon-1", minPrice: 850, maxPrice: 1050, startingPrice: 850 }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);
    const displayPrice = resolveStartingDisplayPrice(toCardPriceInput(deduped[0]));
    expect(displayPrice).toBe(deduped[0].startingPrice);
    expect(displayPrice).not.toBe(deduped[0].maxPrice);
  });
});
