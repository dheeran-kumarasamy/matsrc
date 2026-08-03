// Pure, framework-free statistical helpers for the Builder "price report"
// feature (Buy/Hold/Wait signal, price forecast, landed-cost estimation).
//
// Deliberately NOT an "AI prediction" — the forecast is a transparent
// linear-trend regression over trailing PriceSnapshot rows with a widening
// confidence band, disclosed as such in the UI. This module is designed to
// be swapped out for a more sophisticated method later without touching
// call sites (see computeForecast's `method` string, which the UI renders
// verbatim as its one-sentence methodology disclosure).
//
// No fabricated data: every function here degrades to an honest
// "not enough data" / low-confidence result when the input history is too
// sparse, rather than inventing plausible-looking numbers.

export type HistoryPoint = {
  price: number;
  capturedAt: string | Date;
};

export type ForecastPoint = {
  /** ISO date string for the projected day */
  date: string;
  price: number;
  lower: number;
  upper: number;
};

export type ForecastResult = {
  points: ForecastPoint[];
  /** Per-day trend slope expressed as a fraction of mean price (e.g. 0.001 = +0.1%/day) */
  trendSlopePercent: number;
  /** One-sentence, honest methodology disclosure — render verbatim in the UI */
  method: string;
  /** True once there are enough points to produce a meaningful trend line */
  hasEnoughData: boolean;
};

export type SignalVerdict = "BUY" | "HOLD" | "WAIT";
export type SignalConfidence = "low" | "medium" | "high";

export type SignalResult = {
  verdict: SignalVerdict;
  confidence: SignalConfidence;
  reasons: string[];
};

const MIN_POINTS_FOR_SIGNAL = 5;
const MIN_POINTS_FOR_FORECAST = 3;
const MIN_POINTS_FOR_HIGH_CONFIDENCE = 20;

function toTime(p: HistoryPoint): number {
  return new Date(p.capturedAt).getTime();
}

/** Ascending (oldest first) sorted copy of the history. */
function sortAsc(history: HistoryPoint[]): HistoryPoint[] {
  return [...history].sort((a, b) => toTime(a) - toTime(b));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

/**
 * Percent change between the earliest point at/after `daysAgo` and the
 * latest point in history. Returns null if there isn't a point old enough
 * to compare against (honest "not enough data" signal to callers).
 */
export function momentumOverDays(history: HistoryPoint[], daysAgo: number): number | null {
  if (history.length < 2) return null;
  const asc = sortAsc(history);
  const latest = asc[asc.length - 1];
  const cutoff = new Date(toTime(latest) - daysAgo * 24 * 60 * 60 * 1000).getTime();

  const earliestEligible = asc.find((p) => toTime(p) <= cutoff) ?? asc[0];
  if (toTime(earliestEligible) === toTime(latest)) return null;
  if (earliestEligible.price === 0) return null;

  return (latest.price - earliestEligible.price) / earliestEligible.price;
}

export type RangeStats = {
  min: number;
  max: number;
  /** 0 = at the period low, 1 = at the period high */
  position: number;
} | null;

/** Where the latest price sits within the min–max range of the trailing window. */
export function rangePosition(history: HistoryPoint[], windowDays: number): RangeStats {
  if (history.length === 0) return null;
  const asc = sortAsc(history);
  const latest = asc[asc.length - 1];
  const cutoff = new Date(toTime(latest) - windowDays * 24 * 60 * 60 * 1000).getTime();
  const inWindow = asc.filter((p) => toTime(p) >= cutoff);
  if (inWindow.length === 0) return null;

  const prices = inWindow.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === min) return { min, max, position: 0.5 };

  return { min, max, position: (latest.price - min) / (max - min) };
}

/**
 * Simple least-squares linear regression of price against day-index,
 * projected forward `horizonDays`, with a confidence band that widens with
 * distance from the last observed point (sqrt-of-time heuristic, a
 * standard and transparent approach — not a black-box ML prediction).
 */
export function computeForecast(history: HistoryPoint[], horizonDays: number): ForecastResult {
  const method =
    "Statistical trend projection: linear regression over trailing price snapshots, with a confidence band that widens the further out it projects — not a market prediction.";

  if (history.length < MIN_POINTS_FOR_FORECAST) {
    return { points: [], trendSlopePercent: 0, method, hasEnoughData: false };
  }

  const asc = sortAsc(history);
  const t0 = toTime(asc[0]);
  const xs = asc.map((p) => (toTime(p) - t0) / (24 * 60 * 60 * 1000));
  const ys = asc.map((p) => p.price);

  const n = xs.length;
  const xMean = mean(xs);
  const yMean = mean(ys);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  const residuals = xs.map((x, i) => ys[i] - (intercept + slope * x));
  const residualStd = stdev(residuals);

  const lastX = xs[n - 1];
  const lastDate = new Date(t0 + lastX * 24 * 60 * 60 * 1000);

  const points: ForecastPoint[] = [];
  const step = horizonDays > 14 ? 7 : 1;
  for (let d = step; d <= horizonDays; d += step) {
    const x = lastX + d;
    const predicted = intercept + slope * x;
    const band = residualStd * Math.sqrt(1 + d / n) * 1.28;
    const date = new Date(lastDate.getTime() + d * 24 * 60 * 60 * 1000);
    points.push({
      date: date.toISOString(),
      price: Math.max(0, predicted),
      lower: Math.max(0, predicted - band),
      upper: Math.max(0, predicted + band),
    });
  }

  return {
    points,
    trendSlopePercent: yMean === 0 ? 0 : slope / yMean,
    method,
    hasEnoughData: true,
  };
}

/**
 * Honest Buy/Hold/Wait verdict derived from momentum + 90-day range
 * position + forecast trend direction. Explicitly reports low confidence
 * (rather than fabricating a strong opinion) when there isn't enough
 * history yet.
 */
export function computeSignal(history: HistoryPoint[], forecast: ForecastResult): SignalResult {
  if (history.length < MIN_POINTS_FOR_SIGNAL) {
    return {
      verdict: "HOLD",
      confidence: "low",
      reasons: [
        "Not enough price history for this product yet to generate a confident recommendation.",
        "Check back once more price data has accumulated.",
      ],
    };
  }

  const momentum30 = momentumOverDays(history, 30);
  const range90 = rangePosition(history, 90);
  const slope = forecast.trendSlopePercent;
  const confidence: SignalConfidence = history.length >= MIN_POINTS_FOR_HIGH_CONFIDENCE ? "high" : "medium";

  const reasons: string[] = [];
  let verdict: SignalVerdict = "HOLD";

  if (momentum30 !== null && momentum30 <= -0.03 && slope < 0) {
    verdict = "WAIT";
    reasons.push(
      `Price has fallen ${Math.abs(momentum30 * 100).toFixed(1)}% over the last 30 days and the trend is still declining.`
    );
  } else if (range90 !== null && range90.position <= 0.35 && slope >= 0) {
    verdict = "BUY";
    reasons.push(
      `Current price is near its 90-day low (${Math.round(range90.position * 100)}th percentile of the recent range).`
    );
    if (momentum30 !== null && momentum30 < 0) {
      reasons.push(`Down ${Math.abs(momentum30 * 100).toFixed(1)}% over the last 30 days.`);
    }
  } else if (range90 !== null && range90.position >= 0.75 && slope > 0) {
    verdict = "WAIT";
    reasons.push("Price is near its 90-day high and still trending upward.");
  } else {
    reasons.push("Price is roughly stable within its recent range.");
  }

  if (forecast.hasEnoughData) {
    const direction = slope > 0.0005 ? "rise" : slope < -0.0005 ? "fall" : "stay roughly flat";
    reasons.push(`Statistical forecast suggests price will ${direction} over the next 30 days.`);
  }

  return { verdict, confidence, reasons: reasons.slice(0, 3) };
}

// ─────────────────────────────────────────────
// Landed cost / best-price finder
// ─────────────────────────────────────────────

export type LandedCostBreakdown = {
  basePrice: number;
  quantity: number;
  subtotal: number;
  /** Indicative delivery estimate — actual freight is confirmed at checkout, same disclosure as elsewhere in the app. */
  estimatedDelivery: number;
  gstRatePercent: number;
  gstAmount: number;
  landedCost: number;
  landedUnitCost: number;
};

const DEFAULT_GST_RATE_PERCENT = 18;
// Flat, disclosed-as-indicative delivery estimate used until real
// distance-based freight/logistics integration exists (no Region/geo model
// in the schema today — see docs/site-wise-reports-and-tally-integration.md
// conventions for the same "confirmed at checkout" disclosure pattern used
// by PriceGrid).
const INDICATIVE_DELIVERY_FEE = 250;

export function estimateLandedCost(
  unitPrice: number,
  quantity: number,
  gstRatePercent: number = DEFAULT_GST_RATE_PERCENT
): LandedCostBreakdown {
  const qty = Math.max(1, quantity);
  const subtotal = unitPrice * qty;
  const estimatedDelivery = INDICATIVE_DELIVERY_FEE;
  const taxableValue = subtotal + estimatedDelivery;
  const gstAmount = (taxableValue * gstRatePercent) / 100;
  const landedCost = taxableValue + gstAmount;

  return {
    basePrice: unitPrice,
    quantity: qty,
    subtotal,
    estimatedDelivery,
    gstRatePercent,
    gstAmount,
    landedCost,
    landedUnitCost: landedCost / qty,
  };
}
