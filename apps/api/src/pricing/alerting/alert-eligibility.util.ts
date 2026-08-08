import { ALERT_SUPPRESSION_REASONS, AlertSuppressionReason } from "./alert-suppression-reason";

/**
 * Phase 6D: server-side safety rules for the Watchlist Price Alert engine.
 *
 * These rules are intentionally conservative and mirror the exact gating
 * already used by the public-facing Price Intelligence surfaces
 * (public-pricing.controller.ts, district-pricing/route.ts):
 *   - never alert on a row where publicDisplayAllowed is false (this implies
 *     at least one INTERNAL_ONLY source contributed)
 *   - never alert on LOW confidence
 *   - never alert on a DERIVED_* method (only OBSERVED prices are
 *     alert-eligible — a derived/estimated number is not a strong enough
 *     signal to tell a builder "the price has hit your target")
 *   - never alert on a stale row (priceDate older than the staleness
 *     threshold, reusing the same 72h/3-day threshold used by
 *     computeFreshness() in apps/web/lib/district-pricing.ts)
 */

const STALE_THRESHOLD_HOURS = 24 * 3;

export type EligibilityInput = {
  publicDisplayAllowed: boolean;
  confidence: string; // Confidence enum value
  method: string; // PriceMethod enum value
  priceDate: Date;
  now?: Date;
};

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; suppressedReason: AlertSuppressionReason };

export function checkAlertEligibility(input: EligibilityInput): EligibilityResult {
  if (!input.publicDisplayAllowed) {
    return { eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.INTERNAL_ONLY };
  }

  if (input.confidence === "LOW") {
    return { eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.LOW_CONFIDENCE };
  }

  if (typeof input.method === "string" && input.method.startsWith("DERIVED_")) {
    return { eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.DERIVED_PRICE };
  }

  const now = input.now ?? new Date();
  const ageHours = (now.getTime() - input.priceDate.getTime()) / (1000 * 60 * 60);
  if (ageHours > STALE_THRESHOLD_HOURS) {
    return { eligible: false, suppressedReason: ALERT_SUPPRESSION_REASONS.NO_PRICE };
  }

  return { eligible: true };
}

export { STALE_THRESHOLD_HOURS };
