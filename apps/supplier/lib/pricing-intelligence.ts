// Pure, DB-free helper functions for the Supplier Portal's Phase 6B "Market
// Intelligence" surfaces (Listing Competitiveness, Suggested Pricing Range,
// Opportunity Score, Category Trend volatility). Kept separate from
// lib/supplier-data.ts so the tricky math is unit-testable without mocking
// Prisma — mirrors the existing apps/web/lib/district-pricing.ts pattern.
//
// IMPORTANT (security): none of these helpers ever take or return an
// individual competitor's price/identity. All inputs are aggregate
// statistics (median/p25/p75/observationCount/confidence) already computed
// by the pricing serving layer (PricingDistrictPriceDaily / TrendMonthly).

export type MarketPositionBucket =
  | "MUCH_BELOW_MARKET"
  | "BELOW_MARKET"
  | "WITHIN_MARKET"
  | "ABOVE_MARKET"
  | "MUCH_ABOVE_MARKET";

export const MARKET_POSITION_LABELS: Record<MarketPositionBucket, string> = {
  MUCH_BELOW_MARKET: "Much Below Market",
  BELOW_MARKET: "Below Market",
  WITHIN_MARKET: "Within Market",
  ABOVE_MARKET: "Above Market",
  MUCH_ABOVE_MARKET: "Much Above Market",
};

/// 5-bucket market-position classification for the Listing Competitiveness
/// Report (spec item 2). Uses the P25/P75 band as the "Within Market" zone
/// (same convention as the Builder-side 3-bucket computeMarketPosition), and
/// a wider +/-20% envelope around the band to separate "Below/Above" from
/// "Much Below/Much Above". Falls back to a fixed +/-5%/+/-20% band around
/// the median when P25/P75 are unavailable (derived-only rows).
export function computeMarketPositionBucket(
  sellingPrice: number,
  medianPerBaseUnit: number,
  p25PerBaseUnit: number | null,
  p75PerBaseUnit: number | null
): { bucket: MarketPositionBucket; diffPct: number } {
  const diffPct =
    medianPerBaseUnit > 0 ? ((sellingPrice - medianPerBaseUnit) / medianPerBaseUnit) * 100 : 0;

  const lowerBound = p25PerBaseUnit ?? medianPerBaseUnit * 0.95;
  const upperBound = p75PerBaseUnit ?? medianPerBaseUnit * 1.05;

  // Distance beyond the band, expressed as a further 15% of the median,
  // marks "much" below/above — additive threshold, not exposing any
  // competitor-specific data, purely a function of aggregate stats.
  const muchLowerBound = lowerBound - medianPerBaseUnit * 0.15;
  const muchUpperBound = upperBound + medianPerBaseUnit * 0.15;

  let bucket: MarketPositionBucket;
  if (sellingPrice < muchLowerBound) bucket = "MUCH_BELOW_MARKET";
  else if (sellingPrice < lowerBound) bucket = "BELOW_MARKET";
  else if (sellingPrice > muchUpperBound) bucket = "MUCH_ABOVE_MARKET";
  else if (sellingPrice > upperBound) bucket = "ABOVE_MARKET";
  else bucket = "WITHIN_MARKET";

  return { bucket, diffPct };
}

export type SuggestedPricingBand = {
  conservative: number;
  competitive: number;
  premium: number;
  min: number;
  median: number;
  max: number;
};

/// Suggested pricing band (spec item 3) — guidance only, never used to
/// autofill any price field. Conservative sits near P25 (win volume),
/// Competitive sits at the market median, Premium sits near P75 (margin
/// play). Falls back to a synthetic +/-5% band around the median when
/// P25/P75 are unavailable.
export function computeSuggestedPricingBand(
  medianPerBaseUnit: number,
  p25PerBaseUnit: number | null,
  p75PerBaseUnit: number | null,
  minPerBaseUnit: number | null,
  maxPerBaseUnit: number | null
): SuggestedPricingBand {
  const p25 = p25PerBaseUnit ?? medianPerBaseUnit * 0.95;
  const p75 = p75PerBaseUnit ?? medianPerBaseUnit * 1.05;

  return {
    conservative: Number(p25.toFixed(2)),
    competitive: Number(medianPerBaseUnit.toFixed(2)),
    premium: Number(p75.toFixed(2)),
    min: Number((minPerBaseUnit ?? p25).toFixed(2)),
    median: Number(medianPerBaseUnit.toFixed(2)),
    max: Number((maxPerBaseUnit ?? p75).toFixed(2)),
  };
}

export type OpportunityLevel = "HIGH" | "MEDIUM" | "LOW";

export type OpportunityScoreInput = {
  observationCount: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  districtCoverageCount: number;
  hasSupplierPresence: boolean;
  volatilityPct: number | null; // absolute average month-over-month % swing
  trendDirection: "UP" | "DOWN" | "FLAT" | null;
};

const CONFIDENCE_SCORE: Record<"HIGH" | "MEDIUM" | "LOW", number> = {
  HIGH: 30,
  MEDIUM: 18,
  LOW: 8,
};

/// Multi-factor Pricing Opportunity Score (spec item 4 / District Opportunity
/// Report §6). Produces a 0-100 numeric score plus a High/Medium/Low bucket
/// and a short, deterministic (non-AI) explanation string built purely from
/// the same aggregate factors — never references any competitor.
export function computeOpportunityScore(input: OpportunityScoreInput): {
  score: number;
  level: OpportunityLevel;
  explanation: string;
} {
  let score = 0;
  const reasons: string[] = [];

  // Confidence (0-30)
  score += CONFIDENCE_SCORE[input.confidence];
  reasons.push(`${input.confidence.toLowerCase()} data confidence`);

  // Observation depth (0-20)
  const obsScore = Math.min(20, Math.round((input.observationCount / 30) * 20));
  score += obsScore;
  if (input.observationCount >= 20) reasons.push("strong observation history");
  else if (input.observationCount >= 5) reasons.push("moderate observation history");
  else reasons.push("limited observation history");

  // District coverage (0-20) — more districts with market data = more
  // reachable demand for this material.
  const coverageScore = Math.min(20, input.districtCoverageCount * 4);
  score += coverageScore;

  // Supplier presence (0-15) — no active listing in this district/category
  // yet is itself the "opportunity" (spec §6), so absence scores higher.
  score += input.hasSupplierPresence ? 5 : 15;
  reasons.push(input.hasSupplierPresence ? "you already have a listing here" : "no listing here yet");

  // Price stability (0-15) — lower volatility = safer opportunity to enter
  // at a defensible price point.
  const volatility = input.volatilityPct ?? 0;
  const stabilityScore = Math.max(0, 15 - Math.min(15, Math.round(volatility)));
  score += stabilityScore;
  if (volatility <= 3) reasons.push("stable pricing");
  else if (volatility <= 10) reasons.push("moderate price movement");
  else reasons.push("high price volatility");

  score = Math.max(0, Math.min(100, score));

  let level: OpportunityLevel;
  if (score >= 65) level = "HIGH";
  else if (score >= 40) level = "MEDIUM";
  else level = "LOW";

  const trendNote =
    input.trendDirection === "UP"
      ? "prices trending up"
      : input.trendDirection === "DOWN"
        ? "prices trending down"
        : null;
  if (trendNote) reasons.push(trendNote);

  return {
    score,
    level,
    explanation: `${level === "HIGH" ? "Strong" : level === "MEDIUM" ? "Moderate" : "Limited"} opportunity: ${reasons.join(", ")}.`,
  };
}

/// Average absolute month-over-month % change across a trend series —
/// used as the "volatility" figure for the Category Trend Report and as an
/// input to the opportunity score. Returns null when there isn't enough
/// data to compute a meaningful figure.
export function computeVolatilityPct(momChangePcts: (number | null)[]): number | null {
  const values = momChangePcts.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return null;
  const avgAbs = values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;
  return Number(avgAbs.toFixed(2));
}

export type TrendDirection = "UP" | "DOWN" | "FLAT";

/// Simple first-vs-last comparison across a chronologically-ascending series
/// of monthly medians, used for "12-Month Trend" / "Trend Direction" display
/// columns. A +/-1% band is treated as FLAT to avoid noisy flip-flopping on
/// near-zero movement.
export function computeTrendDirection(monthlyMediansAscending: number[]): TrendDirection | null {
  if (monthlyMediansAscending.length < 2) return null;
  const first = monthlyMediansAscending[0];
  const last = monthlyMediansAscending[monthlyMediansAscending.length - 1];
  if (first === 0) return null;
  const changePct = ((last - first) / first) * 100;
  if (changePct > 1) return "UP";
  if (changePct < -1) return "DOWN";
  return "FLAT";
}

export function computeDiffPct(value: number, baseline: number): number | null {
  if (!baseline) return null;
  return ((value - baseline) / baseline) * 100;
}

/// Formats a monetary value the same way across all Phase 6B surfaces
/// (mirrors the existing formatCurrency in lib/supplier-data.ts, duplicated
/// here so this file has zero DB/Next.js dependencies and stays trivially
/// unit-testable).
export function formatCurrencyINR(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits,
  }).format(value);
}
