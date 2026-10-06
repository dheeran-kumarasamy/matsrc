// packages/db/lib/gst-calculation.ts
//
// Shared, framework-agnostic GST/line-total calculation used by the Supplier
// RFQ Price Revision & GST-Inclusive Order Value feature (see
// apps/api/src/supplier/rfqs/rfqs.service.ts and
// apps/supplier/lib/supplier-data.ts — both quote-submission call sites use
// THIS module rather than re-implementing the math, per the existing
// convention already established for `DEFAULT_TAX_RATE_PERCENT` in
// apps/web/lib/sourcing/landed-cost.ts / site-wise-report.ts / tally-vouchers.ts.
//
// Formula (unchanged from the existing GST convention elsewhere in this
// codebase):
//   lineSubtotal = quantity * unitPrice
//   gstAmount    = lineSubtotal * gstRatePercent / 100
//   lineTotal    = lineSubtotal + gstAmount
//
// Rounding happens only at the END of each computation (never on
// intermediate values), matching the Decimal(12,2)/Decimal(14,2) columns
// these values are ultimately persisted into (SupplierQuote.lineSubtotal /
// gstAmount / lineTotal, OrderItem.unitPrice).
//
// GST rate resolution mirrors the existing, already-established fallback
// used by the site-wise report / Tally export / landed-cost estimator:
// OrderItem.taxRatePercent is nullable — when absent, DEFAULT_TAX_RATE_PERCENT
// (18) applies. No GST rate is ever hard-coded as the ONLY rate — every line
// item may carry its own taxRatePercent, which (when present) always wins.

/**
 * Default GST rate applied when a line item carries no explicit
 * taxRatePercent. Mirrors apps/web/lib/sourcing/landed-cost.ts's identical
 * constant/convention — kept here as the single shared copy for the
 * RFQ-quotation flow so apps/api (NestJS) and apps/supplier (Next.js), which
 * cannot import from apps/web, both apply the exact same default.
 */
export const DEFAULT_TAX_RATE_PERCENT = 18;

/** Rounds to 2 decimal places without floating-point drift. */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Strict validation for a supplier-entered quoted unit price (spec §12):
 * rejects negative values, NaN, Infinity, and non-finite/empty input. Zero is
 * treated as valid here — callers that must reject zero-price quotations per
 * their own business rule should layer that check on top explicitly, since
 * this module makes no assumption about whether ₹0 quotations are allowed.
 */
export function isValidQuotedPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Parses a supplier-submitted price string/number, returning null if invalid. */
export function parseQuotedPrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return isValidQuotedPrice(parsed) ? parsed : null;
}

export type LineGstInput = {
  quantity: number;
  unitPrice: number;
  /** Null/undefined applies DEFAULT_TAX_RATE_PERCENT. */
  gstRatePercent?: number | null;
};

export type LineGstBreakdown = {
  quantity: number;
  unitPrice: number;
  gstRatePercent: number;
  lineSubtotal: number;
  gstAmount: number;
  lineTotal: number;
};

/**
 * Computes the GST breakdown for a single RFQ/quotation line item:
 *   lineSubtotal = quantity * unitPrice
 *   gstAmount    = lineSubtotal * gstRatePercent / 100
 *   lineTotal    = lineSubtotal + gstAmount
 * A gstRatePercent of 0 is honoured as a genuine "GST not applicable" line
 * (gstAmount = 0, lineTotal = lineSubtotal) — never silently replaced with
 * the default.
 */
export function calculateLineGst(input: LineGstInput): LineGstBreakdown {
  const gstRatePercent =
    typeof input.gstRatePercent === "number" && Number.isFinite(input.gstRatePercent)
      ? input.gstRatePercent
      : DEFAULT_TAX_RATE_PERCENT;

  const lineSubtotal = input.quantity * input.unitPrice;
  const gstAmount = (lineSubtotal * gstRatePercent) / 100;
  const lineTotal = lineSubtotal + gstAmount;

  return {
    quantity: input.quantity,
    unitPrice: roundCurrency(input.unitPrice),
    gstRatePercent,
    lineSubtotal: roundCurrency(lineSubtotal),
    gstAmount: roundCurrency(gstAmount),
    lineTotal: roundCurrency(lineTotal),
  };
}

export type QuotationTotals = {
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
};

/**
 * Aggregates a quotation's per-line GST breakdowns into the overall
 * quotation-level totals shown to the supplier before submission (spec §7):
 *   Product Value (subtotal) / GST / Total Order Value (grand total).
 */
export function aggregateQuotationTotals(lines: LineGstBreakdown[]): QuotationTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const gstAmount = lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const grandTotal = subtotal + gstAmount;

  return {
    subtotal: roundCurrency(subtotal),
    gstAmount: roundCurrency(gstAmount),
    grandTotal: roundCurrency(grandTotal),
  };
}
