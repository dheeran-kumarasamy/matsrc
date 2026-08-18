// report-intelligence.ts — P1 (Matsrc Intelligence Integration).
//
// PriceReportView previously derived its Buy/Hold/Wait signal, forecast and
// confidence from `PriceSnapshot` rows alone (a sparse, order/RFQ-derived
// series — see lib/price-forecast.ts) using a standalone calculation that
// duplicated concepts (trend, confidence, forecast) already implemented more
// rigorously for the AI Sourcing Assistant against the canonical Matsrc
// Price Intelligence serving layer (`PricingDistrictPriceDaily`, fed by the
// real observation/rollup pipeline — see lib/sourcing/price-history.ts,
// price-trend.ts, confidence.ts).
//
// This module is the single place that decides, deterministically, which of
// the two data sources to use for one product's report, and assembles the
// report's signal/forecast/confidence from it. It does NOT invent a third
// calculation — every number here is produced by calling the existing pure
// functions from lib/price-forecast.ts and lib/sourcing/*, never
// re-implemented. It touches no Prisma/network code so it stays unit
// testable without mocking the database (route.ts owns all DB access and
// passes already-loaded rows in).

import { computeForecast, computeSignal, type ForecastResult, type HistoryPoint, type SignalResult } from "./price-forecast";
import { computePriceHistory, type PricingDailyRow } from "./sourcing/price-history";
import { classifyPriceTrend } from "./sourcing/price-trend";
import { computeConfidence, type ConfidenceResult } from "./sourcing/confidence";

// Minimum canonical daily observations before we trust the canonical series
// over the platform's own order-history snapshots — mirrors the sourcing
// pipeline's MIN_POINTS_FOR_FORECAST-equivalent threshold in price-trend.ts.
const MIN_CANONICAL_POINTS = 3;

export type ReportDataSource = "district_intelligence" | "order_history" | "insufficient_data";

export type ReportIntelligence = {
  signal: SignalResult;
  forecast: ForecastResult;
  confidence: ConfidenceResult;
  /** Which series the signal/forecast above were actually computed from — rendered verbatim in the UI so a builder knows what backs the numbers. */
  dataSource: ReportDataSource;
  dataGaps: string[];
};

const NO_HISTORY_SIGNAL: SignalResult = {
  verdict: "HOLD",
  confidence: "low",
  reasons: [
    "No price history for this product yet to generate a recommendation.",
    "Check back once price data has accumulated.",
  ],
};

const NO_HISTORY_FORECAST: ForecastResult = {
  points: [],
  trendSlopePercent: 0,
  method:
    "Statistical trend projection: linear regression over trailing price snapshots, with a confidence band that widens the further out it projects — not a market prediction.",
  hasEnoughData: false,
};

/**
 * Assembles the report's signal/forecast/confidence, preferring the
 * canonical district/state price-intelligence series when it has enough
 * observations, and falling back to the platform's own PriceSnapshot series
 * (order/RFQ-derived) when the canonical series is unavailable or too thin.
 * Never blends the two into a single fabricated number — exactly one series
 * backs the output, and `dataSource` discloses which.
 */
export function buildReportIntelligence(params: {
  canonicalDailyRows: PricingDailyRow[];
  snapshotHistory: HistoryPoint[];
  hasSupplierPrice: boolean;
  hasLandedCost: boolean;
  forecastHorizonDays?: number;
}): ReportIntelligence {
  const horizon = params.forecastHorizonDays ?? 30;

  const canonicalStats = computePriceHistory(params.canonicalDailyRows, 120);
  const canUseCanonical = canonicalStats.points.length >= MIN_CANONICAL_POINTS;

  if (canUseCanonical) {
    const canonicalHistoryPoints: HistoryPoint[] = canonicalStats.points.map((p) => ({
      price: p.price,
      capturedAt: p.date,
    }));
    const forecast = computeForecast(canonicalHistoryPoints, horizon);
    const signal = computeSignal(canonicalHistoryPoints, forecast);
    const trend = classifyPriceTrend(canonicalStats.points);
    const confidence = computeConfidence({
      freshness: canonicalStats.freshness,
      observationCount: canonicalStats.observationCount,
      // Daily rows are already an aggregate across sources — sourceCount
      // isn't tracked per-point here, so we conservatively report 1 when
      // any canonical data exists rather than fabricating a higher count.
      sourceCount: canonicalStats.points.length > 0 ? 1 : 0,
      trendDirection: trend.direction,
      hasSupplierPrice: params.hasSupplierPrice,
      hasLandedCost: params.hasLandedCost,
    });

    return {
      signal,
      forecast,
      confidence,
      dataSource: "district_intelligence",
      dataGaps: Array.from(new Set([...canonicalStats.dataGaps, ...trend.dataGaps])),
    };
  }

  // Fall back to the platform's own order/RFQ-derived PriceSnapshot series.
  if (params.snapshotHistory.length === 0) {
    return {
      signal: NO_HISTORY_SIGNAL,
      forecast: NO_HISTORY_FORECAST,
      confidence: computeConfidence({
        freshness: "UNKNOWN",
        observationCount: 0,
        sourceCount: 0,
        trendDirection: "INSUFFICIENT_DATA",
        hasSupplierPrice: params.hasSupplierPrice,
        hasLandedCost: params.hasLandedCost,
      }),
      dataSource: "insufficient_data",
      dataGaps: ["noHistoricalData"],
    };
  }

  const forecast = computeForecast(params.snapshotHistory, horizon);
  const signal = computeSignal(params.snapshotHistory, forecast);
  const snapshotAsPricePoints = params.snapshotHistory.map((p) => ({
    date: typeof p.capturedAt === "string" ? p.capturedAt : p.capturedAt.toISOString(),
    price: p.price,
    observationCount: 1,
    confidence: "LOW" as const,
  }));
  const trend = classifyPriceTrend(snapshotAsPricePoints);
  const confidence = computeConfidence({
    // PriceSnapshot rows carry no independent freshness classification of
    // their own here — use the trend module's data-gap signal as the
    // nearest honest proxy rather than assuming freshness we haven't
    // actually checked.
    freshness: trend.insufficientData ? "UNKNOWN" : "RECENT",
    observationCount: params.snapshotHistory.length,
    sourceCount: 1,
    trendDirection: trend.direction,
    hasSupplierPrice: params.hasSupplierPrice,
    hasLandedCost: params.hasLandedCost,
  });

  return {
    signal,
    forecast,
    confidence,
    dataSource: "order_history",
    dataGaps: trend.dataGaps,
  };
}
