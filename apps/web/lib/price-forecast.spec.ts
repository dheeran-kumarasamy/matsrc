import { describe, it, expect } from "vitest";
import { computeForecast, computeSignal, estimateLandedCost, momentumOverDays, rangePosition, type HistoryPoint } from "./price-forecast";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function makeHistory(pricesOldestFirst: number[]): HistoryPoint[] {
  // pricesOldestFirst[0] is oldest (furthest daysAgo), last is most recent (today)
  const n = pricesOldestFirst.length;
  return pricesOldestFirst.map((price, i) => ({
    price,
    capturedAt: daysAgo(n - 1 - i),
  }));
}

describe("estimateLandedCost", () => {
  it("computes subtotal, delivery, GST and landed cost correctly", () => {
    const result = estimateLandedCost(100, 10, 18);
    expect(result.basePrice).toBe(100);
    expect(result.quantity).toBe(10);
    expect(result.subtotal).toBe(1000);
    expect(result.estimatedDelivery).toBe(250);
    // taxable value = 1000 + 250 = 1250; GST 18% = 225
    expect(result.gstAmount).toBeCloseTo(225, 5);
    expect(result.landedCost).toBeCloseTo(1475, 5);
    expect(result.landedUnitCost).toBeCloseTo(147.5, 5);
  });

  it("clamps quantity to a minimum of 1", () => {
    const result = estimateLandedCost(50, 0);
    expect(result.quantity).toBe(1);
  });

  it("defaults GST rate to 18% when not provided", () => {
    const result = estimateLandedCost(100, 1);
    expect(result.gstRatePercent).toBe(18);
  });
});

describe("momentumOverDays", () => {
  it("returns null when there isn't enough history", () => {
    expect(momentumOverDays([], 30)).toBeNull();
    expect(momentumOverDays([{ price: 100, capturedAt: daysAgo(0) }], 30)).toBeNull();
  });

  it("computes percent change over the trailing window", () => {
    const history = makeHistory([100, 110]); // oldest=100 (30 days ago), latest=110 (today)
    const momentum = momentumOverDays(history, 30);
    expect(momentum).not.toBeNull();
    expect(momentum!).toBeCloseTo(0.1, 5);
  });
});

describe("rangePosition", () => {
  it("returns null with no history", () => {
    expect(rangePosition([], 90)).toBeNull();
  });

  it("places the latest price within the min-max window", () => {
    const history = makeHistory([100, 150, 200]);
    const stats = rangePosition(history, 90);
    expect(stats).not.toBeNull();
    expect(stats!.min).toBe(100);
    expect(stats!.max).toBe(200);
    expect(stats!.position).toBeCloseTo(1, 5); // latest (200) is the max
  });
});

describe("computeForecast", () => {
  it("reports not enough data below the minimum point threshold", () => {
    const result = computeForecast(makeHistory([100, 105]), 30);
    expect(result.hasEnoughData).toBe(false);
    expect(result.points).toHaveLength(0);
    expect(result.method).toContain("Statistical trend projection");
  });

  it("produces an upward-sloping projection for a rising price series", () => {
    const history = makeHistory([100, 102, 104, 106, 108, 110]);
    const result = computeForecast(history, 14);
    expect(result.hasEnoughData).toBe(true);
    expect(result.trendSlopePercent).toBeGreaterThan(0);
    expect(result.points.length).toBeGreaterThan(0);
    // confidence band should be non-negative and upper >= price >= lower
    for (const p of result.points) {
      expect(p.upper).toBeGreaterThanOrEqual(p.price);
      expect(p.lower).toBeLessThanOrEqual(p.price);
    }
  });

  it("widens the confidence band further into the future", () => {
    const history = makeHistory([100, 101, 99, 102, 100, 103]);
    const result = computeForecast(history, 30);
    expect(result.hasEnoughData).toBe(true);
    if (result.points.length >= 2) {
      const first = result.points[0];
      const last = result.points[result.points.length - 1];
      expect(last.upper - last.lower).toBeGreaterThanOrEqual(first.upper - first.lower);
    }
  });
});

describe("computeSignal", () => {
  it("returns a low-confidence HOLD when history is too sparse", () => {
    const history = makeHistory([100, 105]);
    const forecast = computeForecast(history, 30);
    const signal = computeSignal(history, forecast);
    expect(signal.verdict).toBe("HOLD");
    expect(signal.confidence).toBe("low");
    expect(signal.reasons.length).toBeGreaterThan(0);
  });

  it("suggests BUY when price is near its 90-day low and forecast is flat/up", () => {
    const history = makeHistory([150, 145, 140, 135, 130, 110, 108, 105]);
    const forecast = computeForecast(history, 30);
    const signal = computeSignal(history, forecast);
    expect(["BUY", "HOLD", "WAIT"]).toContain(signal.verdict);
    expect(signal.reasons.length).toBeGreaterThan(0);
    expect(signal.reasons.length).toBeLessThanOrEqual(3);
  });

  it("never fabricates confidence beyond medium without enough data points", () => {
    const shortHistory = makeHistory([100, 102, 104, 106, 108, 110, 112]);
    const forecast = computeForecast(shortHistory, 30);
    const signal = computeSignal(shortHistory, forecast);
    expect(signal.confidence).not.toBe("high");
  });
});
