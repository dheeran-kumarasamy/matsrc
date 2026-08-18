// market-benchmark.spec.ts — P2-A (Market Benchmark / "vs. market").
import { describe, expect, it } from "vitest";
import { computeMarketBenchmark, type MarketReferenceInput } from "./market-benchmark";

function districtRef(overrides: Partial<MarketReferenceInput> = {}): MarketReferenceInput {
  return {
    price: 362,
    unit: "BAG",
    geographyLevel: "DISTRICT",
    district: "Coimbatore",
    state: "Tamil Nadu",
    asOf: "2026-08-18",
    isStale: false,
    fallbackUsed: false,
    ...overrides,
  };
}

describe("computeMarketBenchmark", () => {
  it("computes a valid district comparison and labels it District", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 355,
      reference: districtRef(),
    });

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.referenceLevel).toBe("DISTRICT");
      expect(result.locationLabel).toBe("Coimbatore");
      expect(result.differenceAbsolute).toBeCloseTo(355 - 362, 5);
      expect(result.comparisonStatus).toBe("AT_MARKET"); // ~1.9% below, inside ±5% tolerance
    }
  });

  it("labels a state fallback reference as State, not District", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 355,
      reference: districtRef({
        geographyLevel: "STATE",
        district: null,
        fallbackUsed: true,
      }),
    });

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.referenceLevel).toBe("STATE");
      expect(result.locationLabel).toBe("Tamil Nadu");
      expect(result.fallbackUsed).toBe(true);
    }
  });

  it("labels a national fallback reference as National and never implies local precision", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 355,
      reference: districtRef({
        geographyLevel: "NATIONAL",
        district: null,
        state: null,
        fallbackUsed: true,
      }),
    });

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.referenceLevel).toBe("NATIONAL");
      expect(result.locationLabel).toBe("India");
    }
  });

  it("returns an honest unavailable state with no reference data — never ₹0/0%", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 355,
      reference: null,
    });

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.unavailableReason).toBe("NO_REFERENCE_DATA");
    }
  });

  it("refuses to compare incompatible units without a genuine conversion factor", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 355,
      reference: districtRef({ unit: "MT", price: 62000 }),
    });

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.unavailableReason).toBe("UNIT_INCOMPATIBLE");
    }
  });

  it("allows a comparison across units only when a verified conversion factor is supplied", () => {
    const result = computeMarketBenchmark({
      reportUnit: "MT",
      comparisonPrice: 62000, // ₹/MT
      reference: districtRef({ unit: "KG", price: 62 }), // ₹/KG
      unitConversionFactorToReferenceUnit: 1000, // 1 MT = 1000 KG
    });

    expect(result.available).toBe(true);
    if (result.available) {
      // 62000 / 1000 = 62 ₹/KG, matches reference exactly
      expect(result.comparisonPrice).toBeCloseTo(62, 5);
      expect(result.comparisonStatus).toBe("AT_MARKET");
    }
  });

  it("classifies BELOW_MARKET only beyond the tolerance band", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 340, // ~6.1% below 362
      reference: districtRef(),
    });
    expect(result.available).toBe(true);
    if (result.available) expect(result.comparisonStatus).toBe("BELOW_MARKET");
  });

  it("classifies ABOVE_MARKET only beyond the tolerance band", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 385, // ~6.4% above 362
      reference: districtRef(),
    });
    expect(result.available).toBe(true);
    if (result.available) expect(result.comparisonStatus).toBe("ABOVE_MARKET");
  });

  it("classifies AT_MARKET for a tiny rounding difference inside tolerance", () => {
    const result = computeMarketBenchmark({
      reportUnit: "BAG",
      comparisonPrice: 363, // ~0.3% above 362
      reference: districtRef(),
    });
    expect(result.available).toBe(true);
    if (result.available) expect(result.comparisonStatus).toBe("AT_MARKET");
  });
});
