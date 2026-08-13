// confidence.spec.ts — Phase 8 confidence engine tests.
import { describe, expect, it } from "vitest";
import { computeConfidence, type ConfidenceInput } from "./confidence";

const BASE: ConfidenceInput = {
  freshness: "FRESH",
  observationCount: 20,
  sourceCount: 3,
  trendDirection: "STABLE",
  hasSupplierPrice: true,
  hasLandedCost: true,
};

describe("computeConfidence", () => {
  it("returns HIGH when all signals are strong", () => {
    const result = computeConfidence(BASE);
    expect(result.level).toBe("HIGH");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("returns MEDIUM for stale but adequate data", () => {
    const result = computeConfidence({ ...BASE, freshness: "STALE" });
    expect(result.level).not.toBe("HIGH");
    expect(["MEDIUM", "LOW"]).toContain(result.level);
  });

  it("returns LOW for unknown freshness with very few observations", () => {
    const result = computeConfidence({
      ...BASE,
      freshness: "UNKNOWN",
      observationCount: 1,
      sourceCount: 1,
    });
    expect(["LOW", "INSUFFICIENT_DATA"]).toContain(result.level);
  });

  it("returns INSUFFICIENT_DATA when no supplier price and stale", () => {
    const result = computeConfidence({
      ...BASE,
      freshness: "STALE",
      observationCount: 0,
      sourceCount: 0,
      hasSupplierPrice: false,
      hasLandedCost: false,
      trendDirection: "INSUFFICIENT_DATA",
    });
    expect(result.level).toBe("INSUFFICIENT_DATA");
    expect(result.score).toBe(0);
  });

  it("always includes at least one factor string", () => {
    const result = computeConfidence(BASE);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("penalizes volatile trend but not to INSUFFICIENT_DATA alone", () => {
    const result = computeConfidence({ ...BASE, trendDirection: "VOLATILE" });
    // Still should have a meaningful confidence because other signals are strong.
    expect(["HIGH", "MEDIUM"]).toContain(result.level);
  });
});
