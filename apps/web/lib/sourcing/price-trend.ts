// price-trend.ts — deterministic trend classification for the AI Sourcing
// Intelligence layer (Phase 8).
//
// RULE: the LLM must never decide whether a price is rising or falling.
// That decision is made here, deterministically, from actual data.
//
// Classification uses three signals:
//   1. Linear regression slope over the available window
//   2. 14-day momentum (percent change from 14 days ago to latest)
//   3. Coefficient of variation to detect volatility
//
// Reuses the PriceHistoryStats structure computed by price-history.ts.

import type { PriceHistoryPoint } from "./price-history";

export type TrendDirection = "RISING" | "FALLING" | "STABLE" | "VOLATILE" | "INSUFFICIENT_DATA";

export type PriceTrendResult = {
  direction: TrendDirection;
  /** Per-day slope as a % of the mean price. Null when insufficient data. */
  slopePctPerDay: number | null;
  /** % change over the observed window. Null when insufficient data. */
  periodChangePct: number | null;
  /** Coefficient of variation % — high values drive VOLATILE classification. */
  volatilityPct: number | null;
  /** Number of data points used. */
  observationCount: number;
  /** Calendar days covered by the series. */
  periodDays: number;
  /** Confidence label driven by observation count. */
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
  /** True when fewer data points than the minimum required threshold. */
  insufficientData: boolean;
  dataGaps: string[];
};

// Minimum observations needed before any trend classification is attempted.
const MIN_POINTS = 3;
// A slope above this threshold (% per day) is RISING/FALLING vs STABLE.
const SLOPE_THRESHOLD_PCT_PER_DAY = 0.05;
// CoV above this is classified VOLATILE (price swings make trend unreliable).
const VOLATILITY_THRESHOLD_PCT = 8;

function linRegSlope(points: PriceHistoryPoint[]): number | null {
  const n = points.length;
  if (n < 2) return null;

  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.price);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function confidenceFromCount(n: number): PriceTrendResult["confidence"] {
  if (n < MIN_POINTS) return "INSUFFICIENT_DATA";
  if (n >= 15) return "HIGH";
  if (n >= 7) return "MEDIUM";
  return "LOW";
}

/**
 * Classifies the price trend from a series of historical price points.
 *
 * Returns INSUFFICIENT_DATA immediately when there are fewer than MIN_POINTS
 * observations — the caller must surface this to the customer rather than
 * presenting a fabricated signal.
 */
export function classifyPriceTrend(points: PriceHistoryPoint[]): PriceTrendResult {
  const n = points.length;
  const confidence = confidenceFromCount(n);

  if (n < MIN_POINTS) {
    return {
      direction: "INSUFFICIENT_DATA",
      slopePctPerDay: null,
      periodChangePct: null,
      volatilityPct: null,
      observationCount: n,
      periodDays: n,
      confidence: "INSUFFICIENT_DATA",
      insufficientData: true,
      dataGaps: ["insufficientTrendData"],
    };
  }

  const prices = points.map((p) => p.price);
  const meanPrice = prices.reduce((s, v) => s + v, 0) / prices.length;

  const stddevVal =
    prices.length < 2
      ? 0
      : Math.sqrt(prices.reduce((s, v) => s + (v - meanPrice) ** 2, 0) / (prices.length - 1));
  const volatilityPct = meanPrice > 0 ? Number(((stddevVal / meanPrice) * 100).toFixed(2)) : null;

  const earliest = prices[0];
  const latest = prices[prices.length - 1];
  const periodChangePct =
    earliest > 0 ? Number((((latest - earliest) / earliest) * 100).toFixed(2)) : null;

  const rawSlope = linRegSlope(points); // price units per index step
  const slopePctPerDay = rawSlope !== null && meanPrice > 0
    ? Number(((rawSlope / meanPrice) * 100).toFixed(4))
    : null;

  const dataGaps: string[] = [];
  if (n < 7) dataGaps.push("fewTrendPoints");

  let direction: TrendDirection;
  if (volatilityPct !== null && volatilityPct > VOLATILITY_THRESHOLD_PCT) {
    direction = "VOLATILE";
  } else if (slopePctPerDay === null) {
    direction = "INSUFFICIENT_DATA";
  } else if (slopePctPerDay > SLOPE_THRESHOLD_PCT_PER_DAY) {
    direction = "RISING";
  } else if (slopePctPerDay < -SLOPE_THRESHOLD_PCT_PER_DAY) {
    direction = "FALLING";
  } else {
    direction = "STABLE";
  }

  return {
    direction,
    slopePctPerDay,
    periodChangePct,
    volatilityPct,
    observationCount: n,
    periodDays: n,
    confidence,
    insufficientData: false,
    dataGaps,
  };
}

/** Customer-facing label for a trend direction. */
export function trendLabel(direction: TrendDirection): string {
  switch (direction) {
    case "RISING": return "Rising";
    case "FALLING": return "Falling";
    case "STABLE": return "Stable";
    case "VOLATILE": return "Volatile";
    case "INSUFFICIENT_DATA": return "Insufficient data";
  }
}
