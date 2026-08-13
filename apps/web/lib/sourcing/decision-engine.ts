// decision-engine.ts — central intelligence orchestrator for Phase 8.
//
// Combines all deterministic intelligence outputs into one structured
// SourcingDecision. The LLM receives this object and explains it.
// It never recomputes, reorders or changes any figure.

import { computeForecast, computeSignal } from "../price-forecast";
import type { RankedSupplierOption, SourcingRequirement } from "./types";
import { computeBuyTiming } from "./buy-timing";
import type { BuyTimingResult } from "./buy-timing";
import { computeConfidence } from "./confidence";
import type { ConfidenceResult } from "./confidence";
import type { PriceHistoryStats } from "./price-history";
import { identifyRisks } from "./sourcing-risk";
import type { SourcingRisk } from "./sourcing-risk";
import { classifyPriceTrend } from "./price-trend";
import type { PriceTrendResult } from "./price-trend";
import type { ForecastResult } from "../price-forecast";

export type PriceIntelligenceSummary = {
  currentPrice: number | null;
  currentDate: string | null;
  averagePrice: number | null;
  /** % vs average. Null when either value unavailable. */
  vsAveragePct: number | null;
  freshness: "FRESH" | "RECENT" | "STALE" | "UNKNOWN";
  dataGaps: string[];
  /** Historical price series for the chart (oldest→newest). */
  historyPoints: Array<{ date: string; price: number; confidence: string }>;
};

export type SourcingDecision = {
  recommendedOption: RankedSupplierOption | null;
  alternatives: RankedSupplierOption[];
  requirement: SourcingRequirement;
  priceIntelligence: PriceIntelligenceSummary;
  trend: PriceTrendResult;
  forecast: ForecastResult;
  confidence: ConfidenceResult;
  timing: BuyTimingResult;
  risks: SourcingRisk[];
  dataGaps: string[];
};

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

const EMPTY_HISTORY: PriceHistoryStats = {
  currentPrice: null,
  currentDate: null,
  averagePrice: null,
  points: [],
  freshness: "UNKNOWN",
  dataGaps: ["noHistoricalData"],
  priceChangePct: null,
  volatilityPct: null,
  minPrice: null,
  maxPrice: null,
  medianPrice: null,
  periodDays: 0,
  observationCount: 0,
};

/**
 * Assembles a complete SourcingDecision from already-computed parts.
 * All intelligence is deterministic; the LLM only explains the output.
 */
export function buildDecision(params: {
  requirement: SourcingRequirement;
  rankedOptions: RankedSupplierOption[];
  priceHistory: PriceHistoryStats | null;
  /** True when delivery is required within 7 days. */
  urgentDelivery: boolean;
}): SourcingDecision {
  const { requirement, rankedOptions, priceHistory, urgentDelivery } = params;
  const recommended = rankedOptions[0] ?? null;
  const alternatives = rankedOptions.slice(1);
  const history = priceHistory ?? EMPTY_HISTORY;

  const vsAveragePct =
    history.currentPrice !== null && history.averagePrice !== null && history.averagePrice > 0
      ? round2(((history.currentPrice - history.averagePrice) / history.averagePrice) * 100)
      : null;

  const priceIntelligence: PriceIntelligenceSummary = {
    currentPrice: history.currentPrice,
    currentDate: history.currentDate,
    averagePrice: history.averagePrice,
    vsAveragePct,
    freshness: history.freshness,
    dataGaps: history.dataGaps,
    historyPoints: history.points,
  };

  const trend = classifyPriceTrend(history.points);

  const historyForForecast = history.points.map((p) => ({ price: p.price, capturedAt: p.date }));
  const forecast = computeForecast(historyForForecast, 30);
  const signal = computeSignal(historyForForecast, forecast);

  const hasSupplierPrice = (recommended?.landedCost.unitMaterialPrice ?? null) !== null;
  const hasLandedCost = (recommended?.landedCost.estimatedLandedCost ?? null) !== null;

  const confidence = computeConfidence({
    freshness: history.freshness,
    observationCount: history.observationCount,
    sourceCount: history.points.length > 0 ? 1 : 0,
    trendDirection: trend.direction,
    hasSupplierPrice,
    hasLandedCost,
  });

  const timing = computeBuyTiming({
    signal,
    trendDirection: trend.direction,
    forecast,
    confidence: confidence.level,
    canAffordToWait: !urgentDelivery,
    vsAveragePct,
  });

  const risks = identifyRisks({
    priceConfidence: confidence.level,
    freshness: history.freshness,
    observationCount: history.observationCount,
    trendDirection: trend.direction,
    hasDeliveryEstimate: (recommended?.candidate.estimatedDeliveryDays ?? null) !== null,
    productMatchStage: recommended?.candidate.specificationMatch ? "exact" : "fuzzy",
    hasSupplierPrice,
    vsAveragePct,
    forecastHasEnoughData: forecast.hasEnoughData,
  });

  const dataGaps = Array.from(
    new Set([...history.dataGaps, ...(trend.dataGaps ?? []), ...(recommended?.dataGaps ?? [])])
  );

  return {
    recommendedOption: recommended,
    alternatives,
    requirement,
    priceIntelligence,
    trend,
    forecast,
    confidence,
    timing,
    risks,
    dataGaps,
  };
}
