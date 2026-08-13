// price-history.ts — deterministic historical-price statistics for the
// AI Sourcing Intelligence layer (Phase 8).
//
// Pure functions only. Arithmetic is always done here, never by the AI.
// Only publicDisplayAllowed rows are included.

/** One daily price row from PricingDistrictPriceDaily. */
export type PricingDailyRow = {
  priceDate: Date;
  medianPerBaseUnit: number;
  p25PerBaseUnit: number | null;
  p75PerBaseUnit: number | null;
  minPerBaseUnit: number | null;
  maxPerBaseUnit: number | null;
  observationCount: number;
  sourceCount: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  method: string;
  publicDisplayAllowed: boolean;
};

export type PriceHistoryPoint = {
  date: string; // YYYY-MM-DD
  price: number;
  observationCount: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type PriceFreshness = "FRESH" | "RECENT" | "STALE" | "UNKNOWN";

export type PriceHistoryStats = {
  currentPrice: number | null;
  currentDate: string | null;
  averagePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  /** % change from earliest to latest in the window. Null when < 2 points. */
  priceChangePct: number | null;
  /** Coefficient of variation (stddev/mean * 100). Null when < 2 points. */
  volatilityPct: number | null;
  /** Chronological oldest→newest series. */
  points: PriceHistoryPoint[];
  periodDays: number;
  observationCount: number;
  freshness: PriceFreshness;
  dataGaps: string[];
};

const FRESH_DAYS = 1;
const RECENT_DAYS = 7;

function classifyFreshness(currentDate: string | null, now: Date): PriceFreshness {
  if (!currentDate) return "UNKNOWN";
  const ageDays = (now.getTime() - new Date(currentDate).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= FRESH_DAYS) return "FRESH";
  if (ageDays <= RECENT_DAYS) return "RECENT";
  return "STALE";
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1));
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Computes historical price statistics from daily PricingDistrictPriceDaily rows.
 * Only publicDisplayAllowed rows are included.
 * When there is no data, returns an empty result with "noHistoricalData" in dataGaps.
 */
export function computePriceHistory(
  rows: PricingDailyRow[],
  periodDays: number,
  now: Date = new Date()
): PriceHistoryStats {
  const displayable = rows.filter((r) => r.publicDisplayAllowed);

  if (displayable.length === 0) {
    return {
      currentPrice: null,
      currentDate: null,
      averagePrice: null,
      minPrice: null,
      maxPrice: null,
      medianPrice: null,
      priceChangePct: null,
      volatilityPct: null,
      points: [],
      periodDays,
      observationCount: 0,
      freshness: "UNKNOWN",
      dataGaps: ["noHistoricalData"],
    };
  }

  const sorted = [...displayable].sort((a, b) => a.priceDate.getTime() - b.priceDate.getTime());
  const prices = sorted.map((r) => r.medianPerBaseUnit);
  const sortedPrices = [...prices].sort((a, b) => a - b);

  const avg = mean(prices);
  const med = medianOf(sortedPrices);
  const minPrice = sortedPrices[0];
  const maxPrice = sortedPrices[sortedPrices.length - 1];
  const stddevVal = avg !== null ? stddev(prices, avg) : 0;
  const volatilityPct = avg !== null && avg > 0 ? round2((stddevVal / avg) * 100) : null;

  const earliest = prices[0];
  const latest = prices[prices.length - 1];
  const priceChangePct =
    prices.length >= 2 && earliest > 0 ? round2(((latest - earliest) / earliest) * 100) : null;

  const totalObservations = sorted.reduce((s, r) => s + r.observationCount, 0);
  const newestRow = sorted[sorted.length - 1];
  const currentDate = newestRow.priceDate.toISOString().slice(0, 10);
  const freshness = classifyFreshness(currentDate, now);

  const dataGaps: string[] = [];
  if (freshness === "STALE") dataGaps.push("stalePriceData");
  if (totalObservations < 3) dataGaps.push("fewObservations");

  return {
    currentPrice: round2(latest),
    currentDate,
    averagePrice: avg !== null ? round2(avg) : null,
    minPrice: round2(minPrice),
    maxPrice: round2(maxPrice),
    medianPrice: med !== null ? round2(med) : null,
    priceChangePct,
    volatilityPct,
    points: sorted.map((r) => ({
      date: r.priceDate.toISOString().slice(0, 10),
      price: r.medianPerBaseUnit,
      observationCount: r.observationCount,
      confidence: r.confidence,
    })),
    periodDays,
    observationCount: totalObservations,
    freshness,
    dataGaps,
  };
}

/** Formats a price change % with explicit sign. Returns null when null. */
export function formatChangePct(pct: number | null): string | null {
  if (pct === null) return null;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
