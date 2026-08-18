// report-intelligence.spec.ts — P1 (Matsrc Intelligence Integration).
import { describe, expect, it } from "vitest";
import { buildReportIntelligence } from "./report-intelligence";
import type { PricingDailyRow } from "./sourcing/price-history";
import type { HistoryPoint } from "./price-forecast";

const BASE_NOW = new Date("2026-08-13T00:00:00.000Z");

function dailyRow(daysAgo: number, price: number): PricingDailyRow {
  const d = new Date(BASE_NOW);
  d.setDate(d.getDate() - daysAgo);
  return {
    priceDate: d,
    medianPerBaseUnit: price,
    p25PerBaseUnit: null,
    p75PerBaseUnit: null,
    minPerBaseUnit: null,
    maxPerBaseUnit: null,
    observationCount: 4,
    sourceCount: 2,
    confidence: "HIGH",
    method: "OBSERVED",
    publicDisplayAllowed: true,
  };
}

function snapshotPoint(daysAgo: number, price: number): HistoryPoint {
  const d = new Date(BASE_NOW);
  d.setDate(d.getDate() - daysAgo);
  return { price, capturedAt: d };
}

describe("buildReportIntelligence", () => {
  it("prefers the canonical district-intelligence series when it has enough points", () => {
    const result = buildReportIntelligence({
      canonicalDailyRows: [dailyRow(20, 370), dailyRow(10, 360), dailyRow(1, 355)],
      snapshotHistory: [snapshotPoint(5, 400)],
      hasSupplierPrice: true,
      hasLandedCost: true,
    });

    expect(result.dataSource).toBe("district_intelligence");
    expect(result.forecast.hasEnoughData).toBe(true);
  });

  it("falls back to order-history snapshots when the canonical series is too thin", () => {
    const result = buildReportIntelligence({
      canonicalDailyRows: [dailyRow(1, 355)], // below MIN_CANONICAL_POINTS
      snapshotHistory: [snapshotPoint(20, 400), snapshotPoint(10, 390), snapshotPoint(1, 380)],
      hasSupplierPrice: true,
      hasLandedCost: true,
    });

    expect(result.dataSource).toBe("order_history");
  });

  it("reports insufficient_data honestly with neither series present, never fabricating a signal", () => {
    const result = buildReportIntelligence({
      canonicalDailyRows: [],
      snapshotHistory: [],
      hasSupplierPrice: false,
      hasLandedCost: false,
    });

    expect(result.dataSource).toBe("insufficient_data");
    expect(result.signal.verdict).toBe("HOLD");
    expect(result.signal.confidence).toBe("low");
    expect(result.forecast.hasEnoughData).toBe(false);
    expect(result.dataGaps).toContain("noHistoricalData");
  });

  it("never blends canonical and snapshot data into a single series", () => {
    // Canonical has enough points -> snapshotHistory must be completely ignored.
    const result = buildReportIntelligence({
      canonicalDailyRows: [dailyRow(20, 100), dailyRow(10, 100), dailyRow(1, 100)],
      snapshotHistory: [snapshotPoint(1, 999999)],
      hasSupplierPrice: true,
      hasLandedCost: true,
    });

    expect(result.dataSource).toBe("district_intelligence");
    // A stable canonical series (all 100) must not be perturbed by the wildly
    // different snapshot price — confirms the snapshot series was ignored.
    expect(result.signal.reasons.join(" ")).not.toMatch(/999999/);
  });
});
