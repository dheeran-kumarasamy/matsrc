/**
 * Phase 6D: Watchlist Price Alert suppression reasons.
 *
 * These are stored verbatim in PricingAlertEvaluation.suppressedReason
 * (a free-text nullable column — no schema change). Keeping them as a
 * const union here (rather than a Prisma enum) means new reasons can be
 * added without a migration.
 *
 * NOTE ON SCHEMA LIMITS: WATCHLIST_DISABLED and WATCHLIST_EXPIRED are
 * defined for forward-compatibility with the full Phase 6D spec, but the
 * current `Watchlist` model (packages/db/prisma/schema.prisma) has no
 * `enabled`/`expiresAt` columns, so these two reasons are UNREACHABLE
 * under the current schema. They are kept here, documented, and covered
 * by a "not reachable" unit test rather than silently dropped, so the
 * moment the schema gains those columns this module lights up for free.
 */
export const ALERT_SUPPRESSION_REASONS = {
  COOLDOWN: "COOLDOWN",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  DERIVED_PRICE: "DERIVED_PRICE",
  CANONICAL_SKU_UNMAPPED: "CANONICAL_SKU_UNMAPPED",
  DISTRICT_UNRESOLVED: "DISTRICT_UNRESOLVED",
  DUPLICATE_EVALUATION: "DUPLICATE_EVALUATION",
  NO_PRICE: "NO_PRICE",
  RULE_NOT_TRIGGERED: "RULE_NOT_TRIGGERED",
  WATCHLIST_DISABLED: "WATCHLIST_DISABLED",
  WATCHLIST_EXPIRED: "WATCHLIST_EXPIRED",
  INTERNAL_ONLY: "INTERNAL_ONLY",
} as const;

export type AlertSuppressionReason =
  (typeof ALERT_SUPPRESSION_REASONS)[keyof typeof ALERT_SUPPRESSION_REASONS];

/**
 * Customer-facing copy for each suppression reason, shown in the Builder
 * Watchlist UI's alert history. Deliberately does not leak internal
 * pipeline vocabulary (e.g. "DERIVED_INDEX", "quarantined observation") —
 * see docs/pricing/alerting.md ("Customer-facing suppression copy").
 */
export const SUPPRESSION_REASON_COPY: Record<AlertSuppressionReason, string> = {
  COOLDOWN: "We already notified you about this item recently — we wait a bit before alerting again.",
  LOW_CONFIDENCE: "Today's price for this item doesn't have enough market data yet to alert on confidently.",
  DERIVED_PRICE: "Today's price for this item is an estimate for your district, not a directly verified price.",
  CANONICAL_SKU_UNMAPPED: "This item isn't linked to district price data yet.",
  DISTRICT_UNRESOLVED: "We couldn't determine which district to check prices for — add a site to your account.",
  DUPLICATE_EVALUATION: "This item was already evaluated for today.",
  NO_PRICE: "No district price is available for this item today.",
  RULE_NOT_TRIGGERED: "The price hasn't reached your target yet.",
  WATCHLIST_DISABLED: "Alerts are turned off for this watchlist item.",
  WATCHLIST_EXPIRED: "This watchlist item has expired.",
  INTERNAL_ONLY: "Today's price for this item is for internal use only and can't be shown or alerted on.",
};
