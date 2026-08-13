// price-trend.spec.ts — Phase 8 trend classification tests.
import { describe, expect, it } from "vitest";
import { classifyPriceTrend } from "./price-trend";
import type { PriceHistoryPoint } from "./price-history";

function pts(prices: number[]): PriceHistoryPoint[] {
  return prices.map((price, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    price,
    observationCount: 3,
    confidence: "HIGH" as const,
  }));
}

describe("classifyPriceTrend", () => {
  it("returns INSUFFICIENT_DATA when fewer than 3 points", () => {
    expect(classifyPriceTrend(pts([355, 360])).direction).toBe("INSUFFICIENT_DATA");
    expect(classifyPriceTrend([]).direction).toBe("INSUFFICIENT_DATA");
  });

  it("classifies a rising series as RISING", () => {
    const result = classifyPriceTrend(pts([300, 310, 320, 330, 340, 350, 360]));
    expect(result.direction).toBe("RISING");
    expect(result.slopePctPerDay).not.toBeNull();
    expect(result.slopePctPerDay!).toBeGreaterThan(0);
  });

  it("classifies a falling series as FALLING", () => {
    const result = classifyPriceTrend(pts([360, 350, 340, 330, 320, 310, 300]));
    expect(result.direction).toBe("FALLING");
    expect(result.slopePctPerDay!).toBeLessThan(0);
  });

  it("classifies a flat series as STABLE", () => {
    const result = classifyPriceTrend(pts([355, 355, 355, 355, 355, 355, 355]));
    expect(result.direction).toBe("STABLE");
  });

  it("classifies a highly volatile series", () => {
    // Large swings → CoV > threshold
    const result = classifyPriceTrend(pts([200, 500, 150, 600, 100, 700, 200]));
    expect(result.direction).toBe("VOLATILE");
    expect(result.volatilityPct).not.toBeNull();
    expect(result.volatilityPct!).toBeGreaterThan(0);
  });

  it("records insufficientData correctly when below threshold", () => {
    const result = classifyPriceTrend(pts([100, 105]));
    expect(result.insufficientData).toBe(true);
    expect(result.dataGaps).toContain("insufficientTrendData");
  });

  it("gives HIGH confidence with 15+ points", () => {
    const prices = Array.from({ length: 16 }, (_, i) => 300 + i);
    const result = classifyPriceTrend(pts(prices));
    expect(result.confidence).toBe("HIGH");
  });

  it("gives MEDIUM confidence with 7–14 points", () => {
    const prices = Array.from({ length: 10 }, (_, i) => 300 + i);
    const result = classifyPriceTrend(pts(prices));
    expect(result.confidence).toBe("MEDIUM");
  });
});
