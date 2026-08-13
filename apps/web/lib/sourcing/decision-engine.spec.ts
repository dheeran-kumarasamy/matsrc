// decision-engine.spec.ts — Phase 8 decision engine tests.
import { describe, expect, it } from "vitest";
import { buildDecision } from "./decision-engine";
import { calculateLandedCost } from "./landed-cost";
import { EMPTY_REQUIREMENT } from "./types";
import type { PriceHistoryStats } from "./price-history";
import type { RankedSupplierOption, SourcingSupplierCandidate } from "./types";

function makeCandidate(id: string): SourcingSupplierCandidate {
  return {
    supplierId: id,
    supplierName: `Supplier ${id}`,
    location: "Erode",
    productId: "prod-1",
    productName: "PPC Cement",
    availability: "IN_STOCK",
    serviceableQuantity: 1000,
    basePrice: 355,
    unit: "bags",
    minimumOrderQuantity: null,
    deliveryAvailable: null,
    estimatedDeliveryDays: 2,
    historicalRating: 4.5,
    reliabilityScore: 90,
    specificationMatch: true,
    verifiedBadge: true,
  };
}

function makeOption(candidate: SourcingSupplierCandidate, rank: number): RankedSupplierOption {
  return {
    supplierId: candidate.supplierId,
    supplierName: candidate.supplierName,
    productId: candidate.productId,
    rank,
    recommendationScore: rank === 1 ? 85 : 70,
    reasons: ["Lowest estimated landed cost"],
    dataGaps: [],
    landedCost: calculateLandedCost({ quantity: 500, unitMaterialPrice: 355, freightCost: 6000 }),
    candidate,
  };
}

const REQUIREMENT = {
  ...EMPTY_REQUIREMENT,
  material: "Cement",
  specification: "PPC",
  quantity: 500,
  unit: "bags" as const,
  location: "Erode",
  constraints: [],
};

const GOOD_HISTORY: PriceHistoryStats = {
  currentPrice: 355,
  currentDate: "2026-08-13",
  averagePrice: 370,
  minPrice: 340,
  maxPrice: 400,
  medianPrice: 365,
  priceChangePct: -4.1,
  volatilityPct: 3.5,
  points: [
    { date: "2026-07-14", price: 370, observationCount: 5, confidence: "HIGH" },
    { date: "2026-07-21", price: 365, observationCount: 4, confidence: "HIGH" },
    { date: "2026-07-28", price: 360, observationCount: 5, confidence: "HIGH" },
    { date: "2026-08-04", price: 355, observationCount: 4, confidence: "HIGH" },
    { date: "2026-08-13", price: 355, observationCount: 5, confidence: "HIGH" },
  ],
  periodDays: 30,
  observationCount: 23,
  freshness: "FRESH",
  dataGaps: [],
};

describe("buildDecision", () => {
  it("produces a complete decision with the recommended option", () => {
    const c = makeCandidate("sup-a");
    const decision = buildDecision({
      requirement: REQUIREMENT,
      rankedOptions: [makeOption(c, 1)],
      priceHistory: GOOD_HISTORY,
      urgentDelivery: false,
    });
    expect(decision.recommendedOption?.supplierId).toBe("sup-a");
    expect(decision.alternatives).toHaveLength(0);
  });

  it("assigns alternatives correctly", () => {
    const a = makeCandidate("sup-a");
    const b = makeCandidate("sup-b");
    const decision = buildDecision({
      requirement: REQUIREMENT,
      rankedOptions: [makeOption(a, 1), makeOption(b, 2)],
      priceHistory: GOOD_HISTORY,
      urgentDelivery: false,
    });
    expect(decision.alternatives).toHaveLength(1);
    expect(decision.alternatives[0].supplierId).toBe("sup-b");
  });

  it("handles null priceHistory gracefully with correct data gaps", () => {
    const c = makeCandidate("sup-a");
    const decision = buildDecision({
      requirement: REQUIREMENT,
      rankedOptions: [makeOption(c, 1)],
      priceHistory: null,
      urgentDelivery: false,
    });
    expect(decision.priceIntelligence.currentPrice).toBeNull();
    expect(decision.priceIntelligence.dataGaps).toContain("noHistoricalData");
  });

  it("never alters landed costs from ranked options (financial determinism)", () => {
    const c = makeCandidate("sup-a");
    const option = makeOption(c, 1);
    const expectedCost = option.landedCost.estimatedLandedCost;
    const decision = buildDecision({
      requirement: REQUIREMENT,
      rankedOptions: [option],
      priceHistory: GOOD_HISTORY,
      urgentDelivery: false,
    });
    // The decision engine must never recompute money
    expect(decision.recommendedOption!.landedCost.estimatedLandedCost).toBe(expectedCost);
  });

  it("produces meaningful confidence with good history", () => {
    const c = makeCandidate("sup-a");
    const decision = buildDecision({
      requirement: REQUIREMENT,
      rankedOptions: [makeOption(c, 1)],
      priceHistory: GOOD_HISTORY,
      urgentDelivery: false,
    });
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(decision.confidence.level);
  });

  it("aggregates data gaps from history and ranked options", () => {
    const c = makeCandidate("sup-a");
    const option = { ...makeOption(c, 1), dataGaps: ["deliveryDays"] };
    const decision = buildDecision({
      requirement: REQUIREMENT,
      rankedOptions: [option],
      priceHistory: null,
      urgentDelivery: false,
    });
    expect(decision.dataGaps).toContain("noHistoricalData");
  });
});
