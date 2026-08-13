// §25 "Supplier ranking" — the headline requirement:
//   "Verify that the cheapest unit-price supplier is not necessarily
//    recommended when freight makes the landed cost higher."

import { describe, expect, it } from "vitest";

import { calculateLandedCost } from "./landed-cost";
import { canRecommend, rankSuppliers, recommendationHeadline, type RankingCandidate } from "./ranking";
import type { SourcingSupplierCandidate } from "./types";

function candidate(
  overrides: Partial<SourcingSupplierCandidate> & { supplierId: string; supplierName: string }
): SourcingSupplierCandidate {
  return {
    location: "Erode",
    productId: `prod-${overrides.supplierId}`,
    productName: "PPC Cement",
    availability: "IN_STOCK",
    serviceableQuantity: 5000,
    basePrice: 355,
    unit: "bags",
    minimumOrderQuantity: null,
    deliveryAvailable: true,
    estimatedDeliveryDays: 1,
    historicalRating: 4.8,
    reliabilityScore: 96,
    specificationMatch: true,
    verifiedBadge: true,
    ...overrides,
  };
}

describe("rankSuppliers — landed cost beats unit price", () => {
  // Supplier A: ₹355/bag + ₹6,000 freight  -> ₹183,500 total
  // Supplier B: ₹350/bag + ₹12,000 freight -> ₹187,000 total
  const entries: RankingCandidate[] = [
    {
      candidate: candidate({ supplierId: "sup-b", supplierName: "XYZ Materials", basePrice: 350 }),
      landedCost: calculateLandedCost({
        quantity: 500,
        unitMaterialPrice: 350,
        freightCost: 12000,
        deliveryCharges: 0,
        handlingCharges: 0,
        includeTax: false,
      }),
    },
    {
      candidate: candidate({ supplierId: "sup-a", supplierName: "ABC Traders", basePrice: 355 }),
      landedCost: calculateLandedCost({
        quantity: 500,
        unitMaterialPrice: 355,
        freightCost: 6000,
        deliveryCharges: 0,
        handlingCharges: 0,
        includeTax: false,
      }),
    },
  ];

  it("recommends the higher unit price supplier because its delivered total is lower", () => {
    const ranked = rankSuppliers(entries);

    expect(ranked[0].supplierName).toBe("ABC Traders");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].landedCost.estimatedLandedCost).toBe(183500);

    // The cheaper-per-bag supplier is ranked second.
    expect(ranked[1].supplierName).toBe("XYZ Materials");
    expect(ranked[1].landedCost.unitMaterialPrice).toBe(350);
    expect(ranked[1].landedCost.estimatedLandedCost).toBe(187000);
  });

  it("explains the win with a factual landed-cost reason", () => {
    const ranked = rankSuppliers(entries);
    expect(ranked[0].reasons).toContain("Lowest estimated landed cost");
    // The runner-up gets a quantified, non-fabricated comparison.
    expect(ranked[1].reasons.some((reason) => reason.includes("above the lowest option"))).toBe(true);
  });

  it("gives the top option the highest score, capped at 100", () => {
    const ranked = rankSuppliers(entries);
    expect(ranked[0].recommendationScore).toBeGreaterThan(ranked[1].recommendationScore);
    expect(ranked[0].recommendationScore).toBeLessThanOrEqual(100);
  });
});

describe("rankSuppliers — delivery speed and reliability", () => {
  it("prefers faster delivery when landed costs are identical", () => {
    const landed = calculateLandedCost({
      quantity: 100,
      unitMaterialPrice: 100,
      freightCost: 0,
      deliveryCharges: 0,
      handlingCharges: 0,
      includeTax: false,
    });

    const ranked = rankSuppliers([
      {
        candidate: candidate({
          supplierId: "slow",
          supplierName: "Slow Traders",
          estimatedDeliveryDays: 5,
        }),
        landedCost: landed,
      },
      {
        candidate: candidate({
          supplierId: "fast",
          supplierName: "Fast Traders",
          estimatedDeliveryDays: 1,
        }),
        landedCost: landed,
      },
    ]);

    expect(ranked[0].supplierName).toBe("Fast Traders");
  });

  it("does not reward a supplier that simply has no rating data", () => {
    const landed = calculateLandedCost({
      quantity: 100,
      unitMaterialPrice: 100,
      freightCost: 0,
      deliveryCharges: 0,
      handlingCharges: 0,
      includeTax: false,
    });

    const ranked = rankSuppliers([
      {
        candidate: candidate({
          supplierId: "unrated",
          supplierName: "Unrated Traders",
          historicalRating: null,
          reliabilityScore: null,
        }),
        landedCost: landed,
      },
      {
        candidate: candidate({ supplierId: "rated", supplierName: "Rated Traders", historicalRating: 5 }),
        landedCost: landed,
      },
    ]);

    expect(ranked[0].supplierName).toBe("Rated Traders");
    const unrated = ranked.find((option) => option.supplierName === "Unrated Traders")!;
    expect(unrated.dataGaps).toContain("historicalRating");
    expect(unrated.reasons).toContain("No historical rating yet for this supplier");
  });
});

describe("rankSuppliers — unpriced options and recommendation gating", () => {
  it("ranks options with no price BELOW every priced option, without inventing a total", () => {
    const ranked = rankSuppliers([
      {
        candidate: candidate({ supplierId: "nopricing", supplierName: "No Price Traders", basePrice: null }),
        landedCost: calculateLandedCost({ quantity: 500, unitMaterialPrice: null }),
      },
      {
        candidate: candidate({ supplierId: "priced", supplierName: "Priced Traders" }),
        landedCost: calculateLandedCost({
          quantity: 500,
          unitMaterialPrice: 355,
          freightCost: 6000,
          deliveryCharges: 0,
          handlingCharges: 0,
        }),
      },
    ]);

    expect(ranked[0].supplierName).toBe("Priced Traders");
    expect(ranked[1].supplierName).toBe("No Price Traders");
    // Crucially: no fabricated ₹0.
    expect(ranked[1].landedCost.estimatedLandedCost).toBeNull();
    expect(ranked[1].reasons).toContain("Current pricing unavailable — fresh quotation required");
  });

  it("refuses to recommend anything when no option has a computable cost", () => {
    const ranked = rankSuppliers([
      {
        candidate: candidate({ supplierId: "a", supplierName: "A", basePrice: null }),
        landedCost: calculateLandedCost({ quantity: 500, unitMaterialPrice: null }),
      },
    ]);

    expect(canRecommend(ranked)).toBe(false);
    expect(recommendationHeadline(ranked)).toBeNull();
  });

  it("hedges the headline wording rather than claiming an absolute best", () => {
    const priced: RankingCandidate = {
      candidate: candidate({ supplierId: "a", supplierName: "A" }),
      landedCost: calculateLandedCost({
        quantity: 500,
        unitMaterialPrice: 355,
        freightCost: 6000,
        deliveryCharges: 0,
        handlingCharges: 0,
      }),
    };

    // A single option cannot be called "best" — there is nothing to compare.
    expect(recommendationHeadline(rankSuppliers([priced]))).toBe(
      "Only available option based on current data"
    );

    const second: RankingCandidate = {
      candidate: candidate({ supplierId: "b", supplierName: "B" }),
      landedCost: calculateLandedCost({
        quantity: 500,
        unitMaterialPrice: 380,
        freightCost: 6000,
        deliveryCharges: 0,
        handlingCharges: 0,
      }),
    };

    expect(recommendationHeadline(rankSuppliers([priced, second]))).toBe(
      "Best available option based on current data"
    );
  });

  it("returns an empty ranking for no candidates", () => {
    expect(rankSuppliers([])).toEqual([]);
    expect(canRecommend([])).toBe(false);
  });

  it("discloses freight exclusion in the reasons when freight is unknown", () => {
    const ranked = rankSuppliers([
      {
        candidate: candidate({ supplierId: "a", supplierName: "A" }),
        landedCost: calculateLandedCost({
          quantity: 500,
          unitMaterialPrice: 355,
          freightCost: null,
          deliveryCharges: 0,
          handlingCharges: 0,
        }),
      },
    ]);

    expect(ranked[0].reasons).toContain(
      "Freight not included — no verified freight rate for this route"
    );
    expect(ranked[0].dataGaps).toContain("freight");
  });
});
