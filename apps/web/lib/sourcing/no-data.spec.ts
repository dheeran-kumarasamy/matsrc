// §25 "No-data scenarios" + §24 fallback behaviour + §29 anti-hallucination.
//
// Verifies correct handling when there are no products, no suppliers, no prices
// or no availability — the cases where a naive implementation would silently
// invent a supplier, show ₹0, or claim a "best" option it cannot support.

import { describe, expect, it } from "vitest";

import { calculateLandedCost } from "./landed-cost";
import { searchProducts, type SourcingMatchableListing } from "./product-search";
import { canRecommend, rankSuppliers, recommendationHeadline } from "./ranking";
import { validateRequirement } from "./requirement-schema";
import { findSuppliers, partitionByLocation, type SupplierListingRow } from "./supplier-search";
import type { SourcingProductMatch } from "./types";

const REQUIREMENT = validateRequirement({
  material: "Cement",
  specification: "PPC",
  quantity: 500,
  unit: "bags",
  location: "Erode",
});

/** A confident product match for product id `p1`. */
const P1_MATCH: SourcingProductMatch = {
  productId: "p1",
  canonicalProductId: null,
  name: "PPC Cement",
  category: "Cement",
  brand: null,
  grade: "PPC",
  unit: "BAG",
  confidence: 1,
  stage: "exact",
};

function row(overrides: Partial<SupplierListingRow> & { productId: string }): SupplierListingRow {
  return {
    productName: "PPC Cement",
    supplierId: `sup-${overrides.productId}`,
    supplierName: "Test Traders",
    supplierRegion: "Erode",
    verifiedBadge: false,
    isActive: true,
    unit: "BAG",
    brand: null,
    grade: "PPC",
    basePrice: 355,
    stock: 5000,
    maxServiceableQty: 5000,
    pricingTiers: [],
    historicalRating: null,
    leadTimeDays: null,
    ...overrides,
  };
}

describe("no products", () => {
  it("returns no match and asks for clarification when the catalogue is empty", () => {
    const outcome = searchProducts({ requirement: REQUIREMENT, listings: [] });
    expect(outcome.confident).toBe(false);
    expect(outcome.matches).toEqual([]);
    expect(outcome.needsClarification).toBe(true);
  });

  it("finds no suppliers when there are no product matches", () => {
    const suppliers = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: [],
      listings: [row({ productId: "p1" })],
    });
    expect(suppliers).toEqual([]);
  });
});

describe("no suppliers", () => {
  it("returns an empty candidate list when no listing matches the product", () => {
    const suppliers = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: [P1_MATCH],
      listings: [row({ productId: "p-different" })],
    });
    expect(suppliers).toEqual([]);
  });

  it("never sources from an inactive listing", () => {
    const suppliers = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: [P1_MATCH],
      listings: [row({ productId: "p1", isActive: false })],
    });
    expect(suppliers).toEqual([]);
  });

  it("produces no recommendation and no headline from zero candidates", () => {
    const options = rankSuppliers([]);
    expect(options).toEqual([]);
    expect(canRecommend(options)).toBe(false);
    expect(recommendationHeadline(options)).toBeNull();
  });
});

describe("no prices", () => {
  it("keeps the supplier but reports no landed cost", () => {
    const suppliers = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: [P1_MATCH],
      listings: [row({ productId: "p1", basePrice: null })],
    });

    expect(suppliers).toHaveLength(1);
    expect(suppliers[0].basePrice).toBeNull();

    const options = rankSuppliers([
      {
        candidate: suppliers[0],
        landedCost: calculateLandedCost({ quantity: 500, unitMaterialPrice: null }),
      },
    ]);

    // The supplier is still listed honestly, with no fabricated total.
    expect(options).toHaveLength(1);
    expect(options[0].landedCost.estimatedLandedCost).toBeNull();
    expect(options[0].reasons).toContain("Current pricing unavailable — fresh quotation required");
    // And nothing may be recommended off it.
    expect(canRecommend(options)).toBe(false);
  });
});

describe("no availability data", () => {
  it("reports UNKNOWN availability rather than assuming stock", () => {
    const suppliers = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: [P1_MATCH],
      listings: [row({ productId: "p1", stock: 0, maxServiceableQty: null })],
    });

    expect(suppliers[0].availability).toBe("UNKNOWN");
    expect(suppliers[0].serviceableQuantity).toBeNull();
  });

  it("flags PARTIAL when the supplier cannot serve the full quantity", () => {
    const suppliers = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: [P1_MATCH],
      listings: [row({ productId: "p1", stock: 100, maxServiceableQty: 100 })],
    });

    expect(suppliers[0].availability).toBe("PARTIAL");
  });

  it("never invents MOQ, delivery capability or ratings", () => {
    const suppliers = findSuppliers({
      requirement: REQUIREMENT,
      productMatches: [P1_MATCH],
      listings: [row({ productId: "p1" })],
    });

    // None of these are modelled in this schema, so all must be null.
    expect(suppliers[0].minimumOrderQuantity).toBeNull();
    expect(suppliers[0].deliveryAvailable).toBeNull();
    expect(suppliers[0].estimatedDeliveryDays).toBeNull();
    expect(suppliers[0].historicalRating).toBeNull();
    expect(suppliers[0].reliabilityScore).toBeNull();
  });
});

describe("location handling without a serviceability model", () => {
  it("separates in-region from out-of-region rather than hiding suppliers", () => {
    const local = { supplierId: "a", location: "Erode" } as never;
    const distant = { supplierId: "b", location: "Chennai" } as never;

    const { local: inRegion, other } = partitionByLocation([local, distant], "Erode");

    expect(inRegion).toHaveLength(1);
    // The distant supplier is retained, not silently dropped.
    expect(other).toHaveLength(1);
  });

  it("treats every supplier as eligible when no location was given", () => {
    const candidates = [{ supplierId: "a", location: null }] as never[];
    const { local, other } = partitionByLocation(candidates, null);
    expect(local).toHaveLength(1);
    expect(other).toEqual([]);
  });
});
