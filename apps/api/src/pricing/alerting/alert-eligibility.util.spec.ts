import { describe, expect, it } from "vitest";
import { checkAlertEligibility, STALE_THRESHOLD_HOURS } from "./alert-eligibility.util";
import { ALERT_SUPPRESSION_REASONS } from "./alert-suppression-reason";

const NOW = new Date("2026-01-10T00:00:00.000Z");

function freshPriceDate(hoursAgo = 1): Date {
  return new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);
}

describe("checkAlertEligibility", () => {
  it("suppresses with INTERNAL_ONLY when publicDisplayAllowed is false, regardless of other fields", () => {
    const result = checkAlertEligibility({
      publicDisplayAllowed: false,
      confidence: "HIGH",
      method: "OBSERVED",
      priceDate: freshPriceDate(),
      now: NOW,
    });
    expect(result).toEqual({ eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.INTERNAL_ONLY });
  });

  it("suppresses with LOW_CONFIDENCE when confidence is LOW", () => {
    const result = checkAlertEligibility({
      publicDisplayAllowed: true,
      confidence: "LOW",
      method: "OBSERVED",
      priceDate: freshPriceDate(),
      now: NOW,
    });
    expect(result).toEqual({ eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.LOW_CONFIDENCE });
  });

  it("suppresses with DERIVED_PRICE for any method starting with DERIVED_", () => {
    for (const method of ["DERIVED_INDEX", "DERIVED_FREIGHT", "DERIVED_BLENDED"]) {
      const result = checkAlertEligibility({
        publicDisplayAllowed: true,
        confidence: "HIGH",
        method,
        priceDate: freshPriceDate(),
        now: NOW,
      });
      expect(result).toEqual({ eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.DERIVED_PRICE });
    }
  });

  it("suppresses with NO_PRICE when the price is older than the stale threshold", () => {
    const staleDate = new Date(NOW.getTime() - (STALE_THRESHOLD_HOURS + 1) * 60 * 60 * 1000);
    const result = checkAlertEligibility({
      publicDisplayAllowed: true,
      confidence: "HIGH",
      method: "OBSERVED",
      priceDate: staleDate,
      now: NOW,
    });
    expect(result).toEqual({ eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.NO_PRICE });
  });

  it("is eligible right at the boundary just under the stale threshold", () => {
    const almostStaleDate = new Date(NOW.getTime() - (STALE_THRESHOLD_HOURS - 1) * 60 * 60 * 1000);
    const result = checkAlertEligibility({
      publicDisplayAllowed: true,
      confidence: "HIGH",
      method: "OBSERVED",
      priceDate: almostStaleDate,
      now: NOW,
    });
    expect(result).toEqual({ eligible: true });
  });

  it("is eligible when publicDisplayAllowed, confidence != LOW, method is OBSERVED, and fresh", () => {
    const result = checkAlertEligibility({
      publicDisplayAllowed: true,
      confidence: "MEDIUM",
      method: "OBSERVED",
      priceDate: freshPriceDate(),
      now: NOW,
    });
    expect(result).toEqual({ eligible: true });
  });

  it("defaults `now` to the current time when not provided", () => {
    const result = checkAlertEligibility({
      publicDisplayAllowed: true,
      confidence: "HIGH",
      method: "OBSERVED",
      priceDate: new Date(), // essentially now
    });
    expect(result).toEqual({ eligible: true });
  });
});
