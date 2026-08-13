// sourcing-risk.spec.ts — Phase 8 risk identification tests.
import { describe, expect, it } from "vitest";
import { identifyRisks, type RiskInput } from "./sourcing-risk";

const BASE: RiskInput = {
  priceConfidence: "HIGH",
  freshness: "FRESH",
  observationCount: 20,
  trendDirection: "STABLE",
  hasDeliveryEstimate: true,
  productMatchStage: "exact",
  hasSupplierPrice: true,
  vsAveragePct: null,
  forecastHasEnoughData: true,
};

describe("identifyRisks", () => {
  it("returns no risks when all signals are healthy", () => {
    const risks = identifyRisks(BASE);
    expect(risks).toHaveLength(0);
  });

  it("identifies stale price risk", () => {
    const risks = identifyRisks({ ...BASE, freshness: "STALE" });
    expect(risks.some((r) => r.code === "STALE_PRICE")).toBe(true);
    expect(risks.find((r) => r.code === "STALE_PRICE")?.severity).toBe("WARNING");
  });

  it("identifies CRITICAL low confidence", () => {
    const risks = identifyRisks({ ...BASE, priceConfidence: "INSUFFICIENT_DATA" });
    expect(risks.some((r) => r.code === "LOW_PRICE_CONFIDENCE" && r.severity === "CRITICAL")).toBe(true);
  });

  it("identifies insufficient history", () => {
    const risks = identifyRisks({ ...BASE, observationCount: 1 });
    expect(risks.some((r) => r.code === "INSUFFICIENT_HISTORY")).toBe(true);
  });

  it("identifies high volatility", () => {
    const risks = identifyRisks({ ...BASE, trendDirection: "VOLATILE" });
    expect(risks.some((r) => r.code === "HIGH_PRICE_VOLATILITY")).toBe(true);
  });

  it("identifies delivery uncertainty", () => {
    const risks = identifyRisks({ ...BASE, hasDeliveryEstimate: false });
    expect(risks.some((r) => r.code === "DELIVERY_UNCERTAINTY")).toBe(true);
  });

  it("identifies category-level product match uncertainty with WARNING", () => {
    const risks = identifyRisks({ ...BASE, productMatchStage: "category" });
    expect(risks.some((r) => r.code === "PRODUCT_MATCH_UNCERTAINTY" && r.severity === "WARNING")).toBe(true);
  });

  it("identifies fuzzy product match as INFO", () => {
    const risks = identifyRisks({ ...BASE, productMatchStage: "fuzzy" });
    expect(risks.some((r) => r.code === "PRODUCT_MATCH_UNCERTAINTY" && r.severity === "INFO")).toBe(true);
  });

  it("identifies price above average risk", () => {
    const risks = identifyRisks({ ...BASE, vsAveragePct: 15 });
    expect(risks.some((r) => r.code === "PRICE_ABOVE_AVERAGE")).toBe(true);
    expect(risks.find((r) => r.code === "PRICE_ABOVE_AVERAGE")?.message).toContain("15.0%");
  });

  it("does NOT identify price above average when below threshold", () => {
    const risks = identifyRisks({ ...BASE, vsAveragePct: 5 });
    expect(risks.some((r) => r.code === "PRICE_ABOVE_AVERAGE")).toBe(false);
  });

  it("identifies low forecast confidence", () => {
    const risks = identifyRisks({ ...BASE, forecastHasEnoughData: false });
    expect(risks.some((r) => r.code === "FORECAST_LOW_CONFIDENCE")).toBe(true);
  });

  it("returns risks sorted by severity (CRITICAL first)", () => {
    const risks = identifyRisks({
      ...BASE,
      priceConfidence: "INSUFFICIENT_DATA",
      freshness: "STALE",
      hasDeliveryEstimate: false,
    });
    if (risks.length >= 2) {
      const severityOrder = { CRITICAL: 3, WARNING: 2, INFO: 1 };
      for (let i = 1; i < risks.length; i++) {
        expect(severityOrder[risks[i - 1].severity]).toBeGreaterThanOrEqual(
          severityOrder[risks[i].severity]
        );
      }
    }
  });

  it("never invents a risk message for low vsAveragePct", () => {
    const risks = identifyRisks({ ...BASE, vsAveragePct: -5 });
    expect(risks.some((r) => r.code === "PRICE_ABOVE_AVERAGE")).toBe(false);
  });
});
