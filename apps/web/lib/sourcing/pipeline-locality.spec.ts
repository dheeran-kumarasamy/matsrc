// Regression test for the /sourcing candidate-selection bug: location must be
// a DISCLOSURE attribute, never a hard exclusion filter, so a cheaper
// non-local (or unknown-region) supplier is never silently dropped just
// because a local supplier also exists.
//
// This reproduces the exact "Shree Cement OPC 43 Grade Cement, 500 bags, to
// Erode" case found in the production read-only investigation:
//
//   Girinathan Balasundarakumar — Erode      — ₹355/bag
//   Dheeran Kumarasamy          — Tamilnadu  — ₹390.50/bag
//   Mithran G                   — (blank)    — ₹300/bag
//   MITHRAN G CSA ERD           — (blank)    — ₹280/bag
//
// BEFORE the fix, pipeline.ts replaced the candidate list with only the
// region-matching subset whenever at least one existed
// (`local.length > 0 ? local : other`), so only the ₹355 Erode supplier ever
// reached ranking — producing "Only available option" at ₹418.90/bag.
//
// AFTER the fix, every active/eligible candidate (regardless of locality)
// reaches `calculate_landed_cost` + `rank_suppliers`, so the ₹280 supplier
// competes and wins on landed cost (₹330.40/bag), while locality is exposed
// as metadata (`candidate.locality`) rather than used to exclude anyone.

import { describe, expect, it } from "vitest";

import { calculateLandedCost } from "./landed-cost";
import { canRecommend, rankSuppliers, recommendationHeadline } from "./ranking";
import { findSuppliers, type SupplierListingRow } from "./supplier-search";
import { validateRequirement } from "./requirement-schema";
import type { SourcingProductMatch } from "./types";

const REQUIREMENT = validateRequirement({
  material: "Cement",
  specification: "OPC",
  brand: "Shree Cement",
  quantity: 500,
  unit: "bags",
  location: "Erode",
});

/** Builds a confident product match for a given listing/productId. */
function productMatch(productId: string): SourcingProductMatch {
  return {
    productId,
    canonicalProductId: "shree-opc-43",
    name: "Shree Cement OPC 43 Grade Cement",
    category: "Cement",
    brand: "Shree Cement",
    grade: "OPC 43 Grade",
    unit: "BAG",
    confidence: 1,
    stage: "fuzzy",
  };
}

function listingRow(overrides: Partial<SupplierListingRow> & { productId: string }): SupplierListingRow {
  return {
    productName: "Shree Cement OPC 43 Grade Cement",
    supplierId: `sup-${overrides.productId}`,
    supplierName: "Test Supplier",
    supplierRegion: null,
    verifiedBadge: false,
    isActive: true,
    unit: "BAG",
    brand: "Shree Cement",
    grade: "OPC 43 Grade",
    basePrice: 355,
    stock: 5000,
    maxServiceableQty: 5000,
    pricingTiers: [],
    historicalRating: null,
    leadTimeDays: null,
    ...overrides,
  };
}

/** The four real listings found in the production investigation. */
const FOUR_LISTINGS: SupplierListingRow[] = [
  listingRow({
    productId: "erode-listing",
    supplierId: "girinathan",
    supplierName: "Girinathan Balasundarakumar",
    supplierRegion: "Erode",
    basePrice: 355,
    stock: 5200,
    maxServiceableQty: 5200,
  }),
  listingRow({
    productId: "tamilnadu-listing",
    supplierId: "dheeran",
    supplierName: "Dheeran Kumarasamy",
    supplierRegion: "Tamilnadu",
    basePrice: 390.5,
    stock: 5200,
    maxServiceableQty: 5200,
  }),
  listingRow({
    productId: "unknown-300-listing",
    supplierId: "mithran-g",
    supplierName: "Mithran G",
    supplierRegion: null,
    basePrice: 300,
    stock: 1000,
    maxServiceableQty: 1000,
  }),
  listingRow({
    productId: "unknown-280-listing",
    supplierId: "mithran-g-csa-erd",
    supplierName: "MITHRAN G CSA ERD",
    supplierRegion: null,
    basePrice: 280,
    stock: 1000,
    maxServiceableQty: 1000,
  }),
];

/**
 * Mirrors exactly what pipeline.ts's runSourcingTurn() does after
 * find_suppliers (post-fix): every candidate is carried into landed cost +
 * ranking, with no location-based exclusion.
 */
function priceAndRankAll(listings: SupplierListingRow[]) {
  const candidates = findSuppliers({
    requirement: REQUIREMENT,
    productMatches: listings.map((listing) => productMatch(listing.productId)),
    listings,
  });

  const ranking = candidates.map((candidate) => ({
    candidate,
    landedCost: calculateLandedCost({
      quantity: REQUIREMENT.quantity ?? 0,
      unitMaterialPrice: candidate.basePrice,
      freightCost: null,
      deliveryCharges: null,
      handlingCharges: null,
    }),
  }));

  return { candidates, options: rankSuppliers(ranking) };
}

describe("Shree Cement OPC 43 — location must not exclude cheaper suppliers", () => {
  it("carries all four suppliers into find_suppliers regardless of region", () => {
    const candidates = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: FOUR_LISTINGS.map((listing) => productMatch(listing.productId)),
      listings: FOUR_LISTINGS,
    });

    expect(candidates).toHaveLength(4);

    const bySupplier = new Map(candidates.map((c) => [c.supplierId, c]));
    expect(bySupplier.get("girinathan")?.locality).toBe("LOCAL");
    expect(bySupplier.get("dheeran")?.locality).toBe("NON_LOCAL");
    expect(bySupplier.get("mithran-g")?.locality).toBe("UNKNOWN");
    expect(bySupplier.get("mithran-g-csa-erd")?.locality).toBe("UNKNOWN");
  });

  it("ranks the ₹280 unknown-region supplier ABOVE the ₹355 local supplier", () => {
    const { options } = priceAndRankAll(FOUR_LISTINGS);

    expect(options).toHaveLength(4);

    // ₹280 * 1.18 = 330.40 — the true lowest landed cost — must win.
    expect(options[0].supplierId).toBe("mithran-g-csa-erd");
    expect(options[0].landedCost.unitLandedCost).toBe(330.4);
    expect(options[0].candidate.locality).toBe("UNKNOWN");

    // The local (Erode) supplier is NOT excluded, but it is not the cheapest.
    const erodeOption = options.find((option) => option.supplierId === "girinathan");
    expect(erodeOption).toBeDefined();
    expect(erodeOption?.landedCost.unitLandedCost).toBe(418.9);
    expect(erodeOption?.candidate.locality).toBe("LOCAL");
    expect(erodeOption?.rank).toBeGreaterThan(1);
  });

  it("computes the exact GST-inclusive landed cost for every candidate", () => {
    const { options } = priceAndRankAll(FOUR_LISTINGS);
    const byId = new Map(options.map((option) => [option.supplierId, option]));

    expect(byId.get("girinathan")?.landedCost.unitLandedCost).toBe(418.9); // 355 * 1.18
    expect(byId.get("dheeran")?.landedCost.unitLandedCost).toBe(460.79); // 390.50 * 1.18
    expect(byId.get("mithran-g")?.landedCost.unitLandedCost).toBe(354); // 300 * 1.18
    expect(byId.get("mithran-g-csa-erd")?.landedCost.unitLandedCost).toBe(330.4); // 280 * 1.18
  });

  it('does not say "Only available option" when multiple eligible suppliers exist', () => {
    const { options } = priceAndRankAll(FOUR_LISTINGS);
    expect(canRecommend(options)).toBe(true);
    expect(recommendationHeadline(options)).toBe("Best available option based on current data");
  });
});

describe("locality classification — regression matrix", () => {
  it("Test 1: local supplier cheaper than the only other option is selected", () => {
    const listings = [
      listingRow({ productId: "p1", supplierId: "local", supplierRegion: "Erode", basePrice: 280 }),
      listingRow({ productId: "p1", supplierId: "other", supplierRegion: "Chennai", basePrice: 350 }),
    ];
    const { options } = priceAndRankAll(listings);
    expect(options[0].supplierId).toBe("local");
  });

  it("Test 2: non-local supplier cheaper than local remains a candidate and ranks first", () => {
    const listings = [
      listingRow({ productId: "p1", supplierId: "local", supplierRegion: "Erode", basePrice: 350 }),
      listingRow({ productId: "p1", supplierId: "other", supplierRegion: "Chennai", basePrice: 280 }),
    ];
    const { candidates, options } = priceAndRankAll(listings);
    expect(candidates.map((c) => c.supplierId)).toContain("other");
    expect(options[0].supplierId).toBe("other");
  });

  it("Test 3: multiple local suppliers — cheapest wins and both remain visible", () => {
    const listings = [
      listingRow({ productId: "p1", supplierId: "local-a", supplierRegion: "Erode", basePrice: 350 }),
      listingRow({ productId: "p1", supplierId: "local-b", supplierRegion: "Erode", basePrice: 300 }),
    ];
    const { options } = priceAndRankAll(listings);
    expect(options).toHaveLength(2);
    expect(options[0].supplierId).toBe("local-b");
    expect(options.map((o) => o.supplierId)).toEqual(
      expect.arrayContaining(["local-a", "local-b"])
    );
  });

  it("Test 4: blank-region supplier is never silently removed and is labelled UNKNOWN", () => {
    const listings = [
      listingRow({ productId: "p1", supplierId: "local", supplierRegion: "Erode", basePrice: 350 }),
      listingRow({ productId: "p1", supplierId: "unknown", supplierRegion: null, basePrice: 280 }),
    ];
    const { candidates, options } = priceAndRankAll(listings);
    const unknown = candidates.find((c) => c.supplierId === "unknown");
    expect(unknown).toBeDefined();
    expect(unknown?.locality).toBe("UNKNOWN");
    expect(options[0].supplierId).toBe("unknown");
  });

  it("Test 5: a single eligible supplier still yields 'Only available option'", () => {
    const listings = [listingRow({ productId: "p1", supplierId: "solo", supplierRegion: "Erode", basePrice: 355 })];
    const { options } = priceAndRankAll(listings);
    expect(options).toHaveLength(1);
    expect(recommendationHeadline(options)).toBe("Only available option based on current data");
  });

  it("Test 6: multiple suppliers never produce 'Only available option'", () => {
    const { options } = priceAndRankAll(FOUR_LISTINGS);
    expect(recommendationHeadline(options)).not.toBe("Only available option based on current data");
  });

  it("Test 9: inactive suppliers remain excluded regardless of price", () => {
    const listings = [
      listingRow({ productId: "p1", supplierId: "active", supplierRegion: "Erode", basePrice: 355 }),
      listingRow({ productId: "p1", supplierId: "inactive", supplierRegion: null, basePrice: 100, isActive: false }),
    ];
    const { candidates } = priceAndRankAll(listings);
    expect(candidates.map((c) => c.supplierId)).toEqual(["active"]);
  });

  it("Test 10: no eligible suppliers yields no candidates at all", () => {
    const { candidates, options } = priceAndRankAll([]);
    expect(candidates).toEqual([]);
    expect(options).toEqual([]);
    expect(canRecommend(options)).toBe(false);
  });
});
