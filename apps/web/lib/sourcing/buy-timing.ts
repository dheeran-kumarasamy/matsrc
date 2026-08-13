// buy-timing.ts — deterministic buy-timing recommendation (Phase 8).
//
// Combines price history, trend and forecast to produce a BUY_NOW / WAIT /
// MONITOR / INSUFFICIENT_DATA decision. The LLM only explains this decision;
// it does NOT make it.
//
// This reuses lib/price-forecast.ts's computeSignal (BUY/HOLD/WAIT) as one
// input signal, but translates it into the sourcing assistant's vocabulary and
// supplements it with context that computeSignal does not know about
// (delivery deadline urgency, landed-cost availability).

import type { ForecastResult, SignalResult } from "../price-forecast";
import type { TrendDirection } from "./price-trend";
import type { ConfidenceLevel } from "./confidence";

export type TimingRecommendation = "BUY_NOW" | "WAIT" | "MONITOR" | "INSUFFICIENT_DATA";

export type BuyTimingInput = {
  /** From computeSignal(). Null when insufficient data. */
  signal: SignalResult | null;
  /** From classifyPriceTrend(). */
  trendDirection: TrendDirection;
  /** From computeForecast(). Null when insufficient data. */
  forecast: ForecastResult | null;
  /** Confidence level from the confidence engine. */
  confidence: ConfidenceLevel;
  /** True when the customer's delivery deadline allows time to wait (>= 7 days). */
  canAffordToWait: boolean;
  /** % change from 30-day average to current price (negative = below average). */
  vsAveragePct: number | null;
};

export type BuyTimingResult = {
  recommendation: TimingRecommendation;
  /** Short evidence statements for the UI / AI explanation. */
  reasons: string[];
  confidence: ConfidenceLevel;
};

/**
 * Produces a deterministic buy-timing recommendation.
 *
 * Logic hierarchy (in descending priority):
 *   1. INSUFFICIENT_DATA when confidence is too low to advise
 *   2. BUY_NOW when signal=BUY and trend is not RISING steeply
 *   3. WAIT when price is well above average and trend is FALLING
 *   4. MONITOR when uncertain
 *   5. BUY_NOW / MONITOR based on trend and urgency fallback
 */
export function computeBuyTiming(input: BuyTimingInput): BuyTimingResult {
  const { signal, trendDirection, forecast, confidence, canAffordToWait, vsAveragePct } = input;

  if (confidence === "INSUFFICIENT_DATA" || signal === null) {
    return {
      recommendation: "INSUFFICIENT_DATA",
      reasons: ["Not enough price history to make a timing recommendation."],
      confidence,
    };
  }

  const reasons: string[] = [];

  // Translate the underlying signal
  const signalBuy = signal.verdict === "BUY";
  const signalWait = signal.verdict === "WAIT";

  // Delivery urgency override: if the customer cannot wait, we bias toward BUY_NOW
  // unless price is very high above average.
  if (!canAffordToWait) {
    reasons.push("Delivery timeline is soon — waiting may not be practical.");
    if (signalWait && vsAveragePct !== null && vsAveragePct > 10) {
      // Price is materially above average, but they need it urgently.
      reasons.push(...signal.reasons.slice(0, 2));
      return { recommendation: "BUY_NOW", reasons, confidence };
    }
  }

  // Primary: WAIT signal with falling/stable trend and room to wait
  if (signalWait && canAffordToWait && trendDirection !== "RISING") {
    reasons.push(...signal.reasons.slice(0, 2));
    if (vsAveragePct !== null && vsAveragePct > 5) {
      reasons.push(`Current price is ${vsAveragePct.toFixed(1)}% above the recent average.`);
    }
    if (trendDirection === "FALLING") reasons.push("Prices are trending downward.");
    return { recommendation: "WAIT", reasons, confidence };
  }

  // Primary: BUY signal
  if (signalBuy) {
    reasons.push(...signal.reasons.slice(0, 2));
    if (trendDirection === "RISING") {
      reasons.push("Prices are rising — buying now locks in current pricing.");
    }
    return { recommendation: "BUY_NOW", reasons, confidence };
  }

  // Forecast-assisted: rising forecast with room to wait → MONITOR
  if (forecast?.hasEnoughData && forecast.trendSlopePercent > 0.0005 && canAffordToWait) {
    reasons.push("Statistical forecast suggests prices may rise.");
    reasons.push("Monitor closely and consider buying soon if the trend continues.");
    return { recommendation: "MONITOR", reasons, confidence };
  }

  // Stable/default: suggest monitoring
  reasons.push(...signal.reasons.slice(0, 1));
  if (trendDirection === "STABLE") reasons.push("Prices are broadly stable.");
  return {
    recommendation: canAffordToWait ? "MONITOR" : "BUY_NOW",
    reasons,
    confidence,
  };
}

/** Customer-facing label for a timing recommendation. */
export function timingLabel(rec: TimingRecommendation): string {
  switch (rec) {
    case "BUY_NOW": return "Buy Now";
    case "WAIT": return "Wait";
    case "MONITOR": return "Monitor";
    case "INSUFFICIENT_DATA": return "Insufficient data";
  }
}
