// price-history.spec.ts — Phase 8 deterministic history statistics tests.
import { describe, expect, it } from "vitest";
import { computePriceHistory, type PricingDailyRow } from "./price-history";

const BASE_NOW = new Date("2026-08-13T00:00:00.000Z");

function row(overrides: { medianPerBaseUnit: number; daysAgo: number; publicDisplayAllowed?: boolean }): PricingDailyRow {
  const d = new Date(BASE_NOW);
  d.setDate(d.getDate() - overrides.daysAgo);
  return {
    priceDate: d,
    medianPerBaseUnit: overrides.medianPerBaseUnit,
    p25PerBaseUnit: null,
    p75PerBaseUnit: null,
    minPerBaseUnit: null,
    maxPerBaseUnit: null,
    observationCount: 3,
    sourceCount: 2,
    confidence: "HIGH",
    method: "OBSERVED",
    publicDisplayAllowed: overrides.publicDisplayAllowed ?? true,
  };
}

describe("computePriceHistory", () => {
  it("returns empty result with noHistoricalData gap when no rows", () => {
    const result = computePriceHistory([], 30, BASE_NOW);
    expect(result.currentPrice).toBeNull();
    expect(result.averagePrice).toBeNull();
    expect(result.dataGaps).toContain("noHistoricalData");
    expect(result.freshness).toBe("UNKNOWN");
  });

  it("excludes non-public rows", () => {
    const rows = [row({ medianPerBaseUnit: 355, daysAgo: 1, publicDisplayAllowed: false })];
    const result = computePriceHistory(rows, 30, BASE_NOW);
    expect(result.currentPrice).toBeNull();
    expect(result.dataGaps).toContain("noHistoricalData");
  });

  it("computes correct average, min, max for multiple rows", () => {
    const rows = [
      row({ medianPerBaseUnit: 300, daysAgo: 14 }),
      row({ medianPerBaseUnit: 350, daysAgo: 7 }),
      row({ medianPerBaseUnit: 400, daysAgo: 0 }),
    ];
    const result = computePriceHistory(rows, 30, BASE_NOW);
    expect(result.currentPrice).toBe(400);
    expect(result.averagePrice).toBeCloseTo(350, 1);
    expect(result.minPrice).toBe(300);
    expect(result.maxPrice).toBe(400);
    expect(result.points).toHaveLength(3);
  });

  it("returns positive priceChangePct for a rising series", () => {
    const rows = [
      row({ medianPerBaseUnit: 300, daysAgo: 7 }),
      row({ medianPerBaseUnit: 360, daysAgo: 0 }),
    ];
    const result = computePriceHistory(rows, 30, BASE_NOW);
    expect(result.priceChangePct).toBeCloseTo(20, 1);
  });

  it("classifies fresh data correctly", () => {
    const rows = [row({ medianPerBaseUnit: 355, daysAgo: 0 })];
    const result = computePriceHistory(rows, 30, BASE_NOW);
    expect(result.freshness).toBe("FRESH");
    expect(result.dataGaps).not.toContain("stalePriceData");
  });

  it("classifies stale data and adds stalePriceData to dataGaps", () => {
    const rows = [row({ medianPerBaseUnit: 355, daysAgo: 14 })];
    const result = computePriceHistory(rows, 30, BASE_NOW);
    expect(result.freshness).toBe("STALE");
    expect(result.dataGaps).toContain("stalePriceData");
  });

  it("never produces negative prices as zero", () => {
    const rows = [
      row({ medianPerBaseUnit: 100, daysAgo: 5 }),
      row({ medianPerBaseUnit: 200, daysAgo: 0 }),
    ];
    const result = computePriceHistory(rows, 30, BASE_NOW);
    expect(result.currentPrice).toBe(200);
    expect(result.minPrice).toBe(100);
    // No zeros should appear unless the actual data is zero.
    expect(result.minPrice).toBeGreaterThan(0);
  });
});
