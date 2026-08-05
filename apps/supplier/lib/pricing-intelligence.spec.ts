import { describe, it, expect } from "vitest";
import {
  computeMarketPositionBucket,
  computeSuggestedPricingBand,
  computeOpportunityScore,
  computeVolatilityPct,
  computeTrendDirection,
  computeDiffPct,
  MARKET_POSITION_LABELS,
} from "./pricing-intelligence";

describe("computeMarketPositionBucket", () => {
  it("classifies a price within the P25-P75 band as WITHIN_MARKET", () => {
    const result = computeMarketPositionBucket(100, 100, 90, 110);
    expect(result.bucket).toBe("WITHIN_MARKET");
  });

  it("classifies a price just below P25 as BELOW_MARKET", () => {
    const result = computeMarketPositionBucket(85, 100, 90, 110);
    expect(result.bucket).toBe("BELOW_MARKET");
  });

  it("classifies a price far below P25 as MUCH_BELOW_MARKET", () => {
    const result = computeMarketPositionBucket(50, 100, 90, 110);
    expect(result.bucket).toBe("MUCH_BELOW_MARKET");
  });

  it("classifies a price just above P75 as ABOVE_MARKET", () => {
    const result = computeMarketPositionBucket(115, 100, 90, 110);
    expect(result.bucket).toBe("ABOVE_MARKET");
  });

  it("classifies a price far above P75 as MUCH_ABOVE_MARKET", () => {
    const result = computeMarketPositionBucket(160, 100, 90, 110);
    expect(result.bucket).toBe("MUCH_ABOVE_MARKET");
  });

  it("falls back to a synthetic band when P25/P75 are absent", () => {
    expect(computeMarketPositionBucket(100, 100, null, null).bucket).toBe("WITHIN_MARKET");
    expect(computeMarketPositionBucket(70, 100, null, null).bucket).toBe("MUCH_BELOW_MARKET");
  });

  it("computes diffPct relative to the median", () => {
    const result = computeMarketPositionBucket(110, 100, 90, 110);
    expect(result.diffPct).toBeCloseTo(10, 5);
  });

  it("returns 0 diffPct when median is 0", () => {
    const result = computeMarketPositionBucket(50, 0, null, null);
    expect(result.diffPct).toBe(0);
  });

  it("every bucket has a human-friendly label", () => {
    expect(MARKET_POSITION_LABELS.MUCH_BELOW_MARKET).toBe("Much Below Market");
    expect(MARKET_POSITION_LABELS.WITHIN_MARKET).toBe("Within Market");
    expect(MARKET_POSITION_LABELS.MUCH_ABOVE_MARKET).toBe("Much Above Market");
  });
});

describe("computeSuggestedPricingBand", () => {
  it("uses P25/median/P75 as conservative/competitive/premium", () => {
    const band = computeSuggestedPricingBand(100, 90, 110, 80, 120);
    expect(band.conservative).toBe(90);
    expect(band.competitive).toBe(100);
    expect(band.premium).toBe(110);
    expect(band.min).toBe(80);
    expect(band.max).toBe(120);
  });

  it("falls back to a synthetic band when percentiles/min/max are absent", () => {
    const band = computeSuggestedPricingBand(100, null, null, null, null);
    expect(band.conservative).toBe(95);
    expect(band.premium).toBe(105);
    expect(band.min).toBe(95);
    expect(band.max).toBe(105);
  });
});

describe("computeOpportunityScore", () => {
  it("scores a strong, undersupplied, stable opportunity as HIGH", () => {
    const result = computeOpportunityScore({
      observationCount: 40,
      confidence: "HIGH",
      districtCoverageCount: 6,
      hasSupplierPresence: false,
      volatilityPct: 1,
      trendDirection: "FLAT",
    });
    expect(result.level).toBe("HIGH");
    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(result.explanation).toContain("no listing here yet");
  });

  it("scores a weak, low-confidence, already-served opportunity as LOW", () => {
    const result = computeOpportunityScore({
      observationCount: 1,
      confidence: "LOW",
      districtCoverageCount: 1,
      hasSupplierPresence: true,
      volatilityPct: 25,
      trendDirection: null,
    });
    expect(result.level).toBe("LOW");
    expect(result.score).toBeLessThan(40);
  });

  it("never includes competitor-identifying text in the explanation", () => {
    const result = computeOpportunityScore({
      observationCount: 10,
      confidence: "MEDIUM",
      districtCoverageCount: 3,
      hasSupplierPresence: false,
      volatilityPct: 5,
      trendDirection: "UP",
    });
    expect(result.explanation.toLowerCase()).not.toContain("competitor");
    expect(result.explanation.toLowerCase()).not.toContain("supplier ");
  });

  it("clamps score within 0-100", () => {
    const result = computeOpportunityScore({
      observationCount: 1000,
      confidence: "HIGH",
      districtCoverageCount: 100,
      hasSupplierPresence: false,
      volatilityPct: 0,
      trendDirection: "UP",
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("computeVolatilityPct", () => {
  it("computes average absolute month-over-month change", () => {
    expect(computeVolatilityPct([5, -5, 10, -10])).toBe(7.5);
  });

  it("ignores nulls", () => {
    expect(computeVolatilityPct([null, 4, null, -4])).toBe(4);
  });

  it("returns null when no valid values exist", () => {
    expect(computeVolatilityPct([null, null])).toBeNull();
  });
});

describe("computeTrendDirection", () => {
  it("detects an upward trend", () => {
    expect(computeTrendDirection([100, 105, 110])).toBe("UP");
  });

  it("detects a downward trend", () => {
    expect(computeTrendDirection([110, 105, 100])).toBe("DOWN");
  });

  it("detects a flat trend within +/-1%", () => {
    expect(computeTrendDirection([100, 100.5, 100.2])).toBe("FLAT");
  });

  it("returns null with fewer than 2 points", () => {
    expect(computeTrendDirection([100])).toBeNull();
    expect(computeTrendDirection([])).toBeNull();
  });

  it("returns null when the first value is 0", () => {
    expect(computeTrendDirection([0, 10])).toBeNull();
  });
});

describe("computeDiffPct", () => {
  it("computes a positive percentage difference", () => {
    expect(computeDiffPct(110, 100)).toBeCloseTo(10, 5);
  });

  it("returns null when baseline is 0", () => {
    expect(computeDiffPct(50, 0)).toBeNull();
  });
});
