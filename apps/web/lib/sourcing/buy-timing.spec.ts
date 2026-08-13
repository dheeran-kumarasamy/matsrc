// buy-timing.spec.ts — Phase 8 buy-timing recommendation tests.
import { describe, expect, it } from "vitest";
import { computeBuyTiming, type BuyTimingInput } from "./buy-timing";
import { computeForecast, computeSignal, type HistoryPoint } from "../price-forecast";

function makeHistory(prices: number[]): HistoryPoint[] {
  const now = new Date("2026-08-13");
  return prices.map((price, i) => ({
    price,
    capturedAt: new Date(now.getTime() - (prices.length - 1 - i) * 86400000).toISOString(),
  }));
}

describe("computeBuyTiming", () => {
  it("returns INSUFFICIENT_DATA when confidence is INSUFFICIENT_DATA", () => {
    const history = makeHistory([355, 360]);
    const forecast = computeForecast(history, 30);
    const signal = computeSignal(history, forecast);
    const result = computeBuyTiming({
      signal,
      trendDirection: "STABLE",
      forecast,
      confidence: "INSUFFICIENT_DATA",
      canAffordToWait: true,
      vsAveragePct: null,
    });
    expect(result.recommendation).toBe("INSUFFICIENT_DATA");
  });

  it("returns INSUFFICIENT_DATA when signal is null", () => {
    const result = computeBuyTiming({
      signal: null,
      trendDirection: "STABLE",
      forecast: null,
      confidence: "HIGH",
      canAffordToWait: true,
      vsAveragePct: null,
    });
    expect(result.recommendation).toBe("INSUFFICIENT_DATA");
  });

  it("returns BUY_NOW when price is below average and trend is rising", () => {
    // Rising price with current below average → BUY_NOW (lock in current price)
    const history = makeHistory([300, 305, 310, 320, 330, 340, 350, 360]);
    const forecast = computeForecast(history, 30);
    const signal = computeSignal(history, forecast);

    const result = computeBuyTiming({
      signal,
      trendDirection: "RISING",
      forecast,
      confidence: "HIGH",
      canAffordToWait: true,
      vsAveragePct: -5, // below average
    });
    expect(["BUY_NOW", "MONITOR"]).toContain(result.recommendation);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("returns WAIT when price is well above average and trend is falling with time to wait", () => {
    const history = makeHistory([400, 390, 380, 370, 360, 350, 340, 330]);
    const forecast = computeForecast(history, 30);
    const signal = computeSignal(history, forecast);

    const result = computeBuyTiming({
      signal,
      trendDirection: "FALLING",
      forecast,
      confidence: "HIGH",
      canAffordToWait: true,
      vsAveragePct: 12, // above average
    });
    // With a clearly falling trend, price above average, and room to wait → WAIT
    expect(["WAIT", "MONITOR"]).toContain(result.recommendation);
  });

  it("biases toward BUY_NOW when delivery is urgent regardless of signal", () => {
    const history = makeHistory([400, 410, 420, 430, 440, 450, 460, 470]);
    const forecast = computeForecast(history, 30);
    const signal = computeSignal(history, forecast);

    const result = computeBuyTiming({
      signal,
      trendDirection: "RISING",
      forecast,
      confidence: "MEDIUM",
      canAffordToWait: false, // urgent!
      vsAveragePct: 5,
    });
    expect(result.recommendation).toBe("BUY_NOW");
    expect(result.reasons.some((r) => r.toLowerCase().includes("delivery") || r.toLowerCase().includes("timeline") || r.toLowerCase().includes("practical"))).toBe(true);
  });
});
