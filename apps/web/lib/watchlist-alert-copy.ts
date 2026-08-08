// Phase 6D: customer-facing suppression-reason copy for the Builder
// Watchlist UI. Mirrors (does not import — separate Next.js app, cannot
// import NestJS app code) apps/api/src/pricing/alerting/alert-suppression-reason.ts.
// Keep these two lists in sync if a new suppression reason is ever added.

export type AlertSuppressionReason =
  | "COOLDOWN"
  | "LOW_CONFIDENCE"
  | "DERIVED_PRICE"
  | "CANONICAL_SKU_UNMAPPED"
  | "DISTRICT_UNRESOLVED"
  | "DUPLICATE_EVALUATION"
  | "NO_PRICE"
  | "RULE_NOT_TRIGGERED"
  | "WATCHLIST_DISABLED"
  | "WATCHLIST_EXPIRED"
  | "INTERNAL_ONLY";

// Short, customer-friendly explanations — never expose internal jargon like
// "cooldown window" or "derived index" verbatim; explain what it means for
// the builder instead.
export const SUPPRESSION_REASON_COPY: Record<string, string> = {
  COOLDOWN: "We already alerted you about this recently — we won't repeat it for 24 hours.",
  LOW_CONFIDENCE: "Today's price for this material isn't confident enough yet to trigger an alert.",
  DERIVED_PRICE: "Today's price is an estimate, not a verified market price, so we didn't alert you.",
  CANONICAL_SKU_UNMAPPED: "We don't have market pricing mapped for this exact material yet.",
  DISTRICT_UNRESOLVED: "Add a site with a city to get price alerts for your area.",
  DUPLICATE_EVALUATION: "Already checked today.",
  NO_PRICE: "No market price is available for this material today.",
  RULE_NOT_TRIGGERED: "The current price hasn't reached your target yet.",
  WATCHLIST_DISABLED: "Alerts are turned off for this item.",
  WATCHLIST_EXPIRED: "This watchlist alert has expired.",
  INTERNAL_ONLY: "Today's price isn't available for public display yet.",
};

export function suppressionReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return SUPPRESSION_REASON_COPY[reason] ?? reason;
}
