import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { dedupeByCanonicalGroup, parseListingPrice, type SupplierListing } from "./listings";
import { resolveStartingDisplayPrice } from "./product-price-display";

function makeListing(overrides: Partial<SupplierListing> & { id: string; supplierId: string }): SupplierListing {
  return {
    name: "Vizag Steel 20mm TMT Bar Fe 500D",
    category: "Steel",
    grade: "Fe 500D",
    sizeLabel: "20mm",
    unit: "KGS",
    price: "₹65 / KGS",
    stock: "100000 KGS",
    maxServiceableQty: "100000 KGS",
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

describe("PLP SKU Combination Based on Product Details (Requirement 2)", () => {
  it("combines multiple skus for 'Vizag Steel 20mm TMT Bar Fe 500D' into 1 entry even if prices and canonicalProductIds are different", () => {
    const listings: SupplierListing[] = [
      makeListing({
        id: "prod-1",
        supplierId: "sup-1",
        name: "Vizag Steel 20mm TMT Bar Fe 500D",
        brand: "Vizag Steel",
        canonicalProductId: "canon-vizag-steel-20mm",
        price: "₹65 / KGS",
        startingPrice: 65,
      }),
      makeListing({
        id: "prod-2",
        supplierId: "sup-2",
        name: "Vizag Steel 20mm TMT Bar Fe 500D",
        brand: "Vizag",
        canonicalProductId: "canon-vizag-20mm",
        price: "₹65 / KGS",
        startingPrice: 64.5,
      }),
      makeListing({
        id: "prod-3",
        supplierId: "sup-3",
        name: "Vizag Steel 20mm TMT Bar Fe 500D",
        brand: "Vizag Steel",
        canonicalProductId: "canon-vizag-steel-20mm",
        price: "₹66 / KGS",
        startingPrice: 65.5,
      }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);

    // Exactly 1 collapsed entry on the page
    expect(deduped).toHaveLength(1);
    const combined = deduped[0];

    expect(combined.name).toBe("Vizag Steel 20mm TMT Bar Fe 500D");
    // Displays the lowest starting price (64.5)
    expect(combined.startingPrice).toBe(64.5);
    expect(resolveStartingDisplayPrice({
      startingPrice: combined.startingPrice,
      price: parseListingPrice(combined.price),
    })).toBe(64.5);

    // Headline price reflects lowest price
    expect(combined.price).toBe("₹64.5 / KGS");

    // All 3 listing IDs are grouped together
    expect(combined.groupedListingIds).toContain("prod-1");
    expect(combined.groupedListingIds).toContain("prod-2");
    expect(combined.groupedListingIds).toContain("prod-3");

    // Reflects all 3 quoting suppliers
    expect(combined.supplierCount).toBe(3);
  });

  it("keeps different sizes (e.g. 20mm vs 16mm) as separate entries", () => {
    const listings: SupplierListing[] = [
      makeListing({
        id: "prod-20mm-1",
        supplierId: "sup-1",
        name: "Vizag Steel 20mm TMT Bar Fe 500D",
        sizeLabel: "20mm",
        price: "₹65 / KGS",
        startingPrice: 65,
      }),
      makeListing({
        id: "prod-20mm-2",
        supplierId: "sup-2",
        name: "Vizag Steel 20mm TMT Bar Fe 500D",
        sizeLabel: "20mm",
        price: "₹64.5 / KGS",
        startingPrice: 64.5,
      }),
      makeListing({
        id: "prod-16mm-1",
        supplierId: "sup-1",
        name: "Vizag Steel 16mm TMT Bar Fe 500D",
        sizeLabel: "16mm",
        price: "₹65 / KGS",
        startingPrice: 65,
      }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);
    expect(deduped).toHaveLength(2);

    const bar20mm = deduped.find((l) => l.name.includes("20mm"));
    const bar16mm = deduped.find((l) => l.name.includes("16mm"));

    expect(bar20mm).toBeDefined();
    expect(bar16mm).toBeDefined();
    expect(bar20mm?.startingPrice).toBe(64.5);
    expect(bar20mm?.groupedListingIds).toHaveLength(2);
    expect(bar16mm?.groupedListingIds).toHaveLength(1);
  });

  it("keeps different brands (e.g. Durastrong vs Raipur Binding Wire) separate", () => {
    const listings: SupplierListing[] = [
      makeListing({
        id: "wire-1",
        supplierId: "sup-1",
        name: "Binding wire",
        brand: "Durastrong",
        grade: "Mild Steel (MS) Annealed",
        sizeLabel: "18 SWG (1.2mm)",
        price: "₹75 / KGS",
      }),
      makeListing({
        id: "wire-2",
        supplierId: "sup-2",
        name: "Binding wire",
        brand: "Raipur",
        grade: "Mild Steel (MS) Annealed",
        sizeLabel: "18 SWG (1.2mm)",
        price: "₹77 / KGS",
      }),
    ];

    const deduped = dedupeByCanonicalGroup(listings);
    expect(deduped).toHaveLength(2);
  });
});

describe("ProductCard Supplier Label Suppression (Requirement 1)", () => {
  const cardSource = readFileSync(
    path.resolve(__dirname, "../components/products/ProductCard.tsx"),
    "utf-8"
  );

  it("does not import getSupplierDisplayName in ProductCard", () => {
    expect(cardSource).not.toMatch(/getSupplierDisplayName/);
  });

  it("does not render supplier name or (Supplier 1) below product name", () => {
    expect(cardSource).not.toMatch(/getSupplierDisplayName\(/);
    expect(cardSource).not.toMatch(/product\.supplier\b/);
  });
});
