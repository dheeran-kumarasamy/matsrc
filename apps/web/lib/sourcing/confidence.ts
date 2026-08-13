// confidence.ts — sourcing data-quality confidence engine (Phase 8).
//
// Aggregates signals from price history, trend, and supplier data into a
// single confidence level. The LLM may explain the level but must not invent it.
//
// Factors weighted in order of importance:
//   1. Data freshness (STALE → heavily penalizes)
//   2. Observation count (few observations → lower confidence)
//   3. Source count (single source → uncertainty)
//   4. Trend reliability (INSUFFICIENT_DATA/VOLATILE → lower)
//   5. Supplier data completeness (missing price → lower)

import type { PriceFreshness } from "./price-history";
import type { TrendDirection } from "./price-trend";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";

export type ConfidenceInput = {
  freshness: PriceFreshness;
  observationCount: number;
  sourceCount: number;
  trendDirection: TrendDirection;
  /** True when the supplier's own product price is available. */
  hasSupplierPrice: boolean;
  /** True when a landed-cost total could be computed (price was not null). */
  hasLandedCost: boolean;
};

export type ConfidenceResult = {
  level: ConfidenceLevel;
  /** 0–100 internal score (not shown to customer; drives level). */
  score: number;
  /** Short phrases explaining the score. Shown in UI. */
  factors: string[];
};

/**
 * Computes a confidence level for a sourcing recommendation.
 *
 * Score is 0-100. Thresholds:
 *   >= 70 → HIGH
 *   >= 40 → MEDIUM
 *   >= 1  → LOW
 *   0     → INSUFFICIENT_DATA
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  let score = 100;
  const factors: string[] = [];

  // Freshness
  if (input.freshness === "UNKNOWN") {
    score -= 50;
    factors.push("No price date available");
  } else if (input.freshness === "STALE") {
    score -= 35;
    factors.push("Price data may be outdated");
  } else if (input.freshness === "RECENT") {
    score -= 5;
    factors.push("Price data from past week");
  } else {
    factors.push("Price data is current");
  }

  // Observation count
  if (input.observationCount === 0) {
    score -= 40;
    factors.push("No observations available");
  } else if (input.observationCount < 3) {
    score -= 25;
    factors.push(`Only ${input.observationCount} observation${input.observationCount === 1 ? "" : "s"} available`);
  } else if (input.observationCount < 10) {
    score -= 10;
    factors.push(`${input.observationCount} observations available`);
  } else {
    factors.push(`${input.observationCount} observations from verified sources`);
  }

  // Source count
  if (input.sourceCount === 0) {
    score -= 20;
  } else if (input.sourceCount === 1) {
    score -= 10;
    factors.push("Single source");
  } else {
    factors.push(`${input.sourceCount} sources`);
  }

  // Trend reliability
  if (input.trendDirection === "INSUFFICIENT_DATA") {
    score -= 15;
    factors.push("Insufficient history for trend analysis");
  } else if (input.trendDirection === "VOLATILE") {
    score -= 10;
    factors.push("Price is volatile");
  }

  // Supplier price presence
  if (!input.hasSupplierPrice) {
    score -= 20;
    factors.push("Supplier current price unavailable");
  }

  // Landed cost
  if (!input.hasLandedCost) {
    score -= 5;
    factors.push("Estimated landed cost unavailable");
  }

  const clampedScore = Math.max(0, Math.min(100, score));

  let level: ConfidenceLevel;
  if (clampedScore >= 70) level = "HIGH";
  else if (clampedScore >= 40) level = "MEDIUM";
  else if (clampedScore >= 1) level = "LOW";
  else level = "INSUFFICIENT_DATA";

  return { level, score: clampedScore, factors };
}

/** Customer-facing label for a confidence level. */
export function confidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case "HIGH": return "High";
    case "MEDIUM": return "Medium";
    case "LOW": return "Low";
    case "INSUFFICIENT_DATA": return "Insufficient data";
  }
}
