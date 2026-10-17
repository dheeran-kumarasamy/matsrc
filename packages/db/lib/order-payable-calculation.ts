// packages/db/lib/order-payable-calculation.ts
//
// Product-Level GST / GST-Inclusive Buyer Payable / Advance Configuration —
// shared, framework-agnostic calculation that composes markup-calculation.ts
// and gst-rate-resolution.ts into the single order-level payable/advance
// model described in Order.taxAmount's schema doc comment:
//
//   buyerUnitPrice      = supplierUnitPrice * (1 + markupPercent / 100)
//   lineTaxableValue    = buyerUnitPrice * quantity        (marked-up value,
//                         GST is calculated on the BUYER price, never the
//                         original supplier price)
//   lineTaxAmount       = lineTaxableValue * taxRatePercent / 100
//   lineTotal           = lineTaxableValue + lineTaxAmount
//
//   subtotal            = Σ lineTaxableValue across every line
//   taxAmount           = Σ lineTaxAmount across every line
//   finalPayableAmount  = subtotal + taxAmount
//
//   requiredAdvanceAmount = roundCurrency(finalPayableAmount * advancePercent
//                           / 100) — purely informational (see AdvanceConfig's
//                           schema doc comment); never gates confirmation.
//
//   remainingBalance    = finalPayableAmount - creditedAmount, floored at 0
//                         (mirrors apps/web/lib/order-outstanding.ts's
//                         Math.max(0, ...) convention) — `creditedAmount` is
//                         supplied by the caller (e.g. advance ledger /
//                         payment records already consumed against this
//                         order); this module never queries those tables
//                         itself.
//
// Rounding happens only at the END of each line/aggregate computation (never
// on intermediate values) — mirrors calculateLineGst's/calculateMarkup's
// identical convention, using the SAME roundCurrency.
//
// This module is pure: every GST rate and markup percentage is passed in,
// already resolved by the caller (resolveGstRate / resolveEffectiveMarkupPercent
// — Phase 2's confirmation-path writer is responsible for calling those and
// refusing to proceed when a line's GST rate is unresolved; this module
// NEVER invents a rate and NEVER silently treats an unresolved rate as 0%).

import { roundCurrency } from "./gst-calculation";
import { calculateMarkup } from "./markup-calculation";
import { isValidTaxPercent } from "./gst-rate-resolution";

export type OrderPayableLineInput = {
  /** Original, never-overwritten supplier unit price for this line. */
  supplierUnitPrice: number;
  /** Admin-configured markup percentage already resolved for this line. */
  markupPercent: number;
  /** GST percentage already resolved for this line (see gst-rate-resolution.ts). */
  taxRatePercent: number;
  quantity: number;
};

export type OrderPayableLineResult = {
  quantity: number;
  supplierUnitPrice: number;
  markupPercent: number;
  buyerUnitPrice: number;
  markupAmount: number;
  taxRatePercent: number;
  lineTaxableValue: number;
  taxAmount: number;
  lineTotal: number;
};

/**
 * Validates and normalizes a line-item quantity: strictly positive,
 * finite integers only — a quantity of 0 or a fractional unit count would
 * indicate malformed caller input (unlike price/percentage fields, which
 * legitimately support 0).
 */
export function isValidQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

/**
 * Computes the full buyer-facing breakdown for a single order line:
 * markup (reusing calculateMarkup — markup is applied exactly once, from
 * the ORIGINAL supplierUnitPrice, never from an already-marked-up value),
 * then GST on the marked-up buyer taxable value (buyerUnitPrice * quantity).
 * Throws on invalid supplierUnitPrice/markupPercent/taxRatePercent/quantity
 * rather than silently coercing — mirrors calculateMarkup's/calculateLineGst's
 * identical fail-fast policy.
 */
export function calculateOrderPayableLine(input: OrderPayableLineInput): OrderPayableLineResult {
  if (!isValidQuantity(input.quantity)) {
    throw new Error(`Invalid quantity for order payable calculation: ${input.quantity}`);
  }
  if (!isValidTaxPercent(input.taxRatePercent)) {
    throw new Error(`Invalid tax rate percentage for order payable calculation: ${input.taxRatePercent}`);
  }

  // calculateMarkup independently validates supplierUnitPrice/markupPercent
  // and throws with its own descriptive message on invalid input — reused
  // here rather than duplicating that validation logic.
  const markup = calculateMarkup({
    supplierUnitPrice: input.supplierUnitPrice,
    markupPercent: input.markupPercent,
  });

  // GST is calculated on the MARKED-UP buyer value, never the original
  // supplier price (see this module's top doc comment) — lineTaxableValue
  // uses markup.buyerUnitPrice, never markup.supplierUnitPrice.
  const lineTaxableValueRaw = markup.buyerUnitPrice * input.quantity;
  const taxAmountRaw = (lineTaxableValueRaw * input.taxRatePercent) / 100;
  const lineTotalRaw = lineTaxableValueRaw + taxAmountRaw;

  return {
    quantity: input.quantity,
    supplierUnitPrice: markup.supplierUnitPrice,
    markupPercent: markup.markupPercent,
    buyerUnitPrice: markup.buyerUnitPrice,
    markupAmount: markup.markupAmount,
    taxRatePercent: input.taxRatePercent,
    lineTaxableValue: roundCurrency(lineTaxableValueRaw),
    taxAmount: roundCurrency(taxAmountRaw),
    lineTotal: roundCurrency(lineTotalRaw),
  };
}

export type OrderPayableTotals = {
  lines: OrderPayableLineResult[];
  /** Σ lineTaxableValue across every line (GST-exclusive, marked-up subtotal). */
  subtotal: number;
  /** Σ taxAmount across every line. */
  taxAmount: number;
  /** subtotal + taxAmount — the GST-inclusive figure persisted to Order.finalPayableAmount. */
  finalPayableAmount: number;
};

/**
 * Computes every line's breakdown and aggregates them into the order-level
 * totals persisted to Order.taxAmount/finalPayableAmount. Summing is done
 * on the ALREADY-ROUNDED per-line figures (lineTaxableValue/taxAmount),
 * exactly like aggregateQuotationTotals — this avoids a second source of
 * floating-point drift from re-deriving totals off raw (unrounded)
 * intermediate values, and keeps the per-line and order-level figures
 * reconciling exactly (Σ lines.lineTaxableValue === subtotal).
 */
export function calculateOrderPayableTotals(lineInputs: OrderPayableLineInput[]): OrderPayableTotals {
  const lines = lineInputs.map(calculateOrderPayableLine);

  const subtotal = lines.reduce((sum, line) => sum + line.lineTaxableValue, 0);
  const taxAmount = lines.reduce((sum, line) => sum + line.taxAmount, 0);
  const finalPayableAmount = subtotal + taxAmount;

  return {
    lines,
    subtotal: roundCurrency(subtotal),
    taxAmount: roundCurrency(taxAmount),
    finalPayableAmount: roundCurrency(finalPayableAmount),
  };
}

/**
 * Strict validation for an admin-configured advance percentage — identical
 * policy to isValidTaxPercent/isValidMarkupPercent (reject negative/NaN/
 * non-finite; no statutory ceiling enforced here; an explicit 0% is valid).
 */
export function isValidAdvancePercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Computes the informational required-advance amount from the ALREADY
 * GST-inclusive final payable — never from the GST-exclusive subtotal (see
 * Order.requiredAdvanceAmount's schema doc comment). Returns null when
 * advancePercent is null/undefined, mirroring the schema's "null whenever
 * advancePercent is null" contract — this is never coerced to 0, since a
 * missing advance configuration is informationally different from an
 * explicit 0% advance target.
 */
export function calculateRequiredAdvanceAmount(
  finalPayableAmount: number,
  advancePercent: number | null | undefined
): number | null {
  if (advancePercent === null || advancePercent === undefined) return null;
  if (!isValidAdvancePercent(advancePercent)) {
    throw new Error(`Invalid advance percentage for required-advance calculation: ${advancePercent}`);
  }
  if (!Number.isFinite(finalPayableAmount) || finalPayableAmount < 0) {
    throw new Error(`Invalid final payable amount for required-advance calculation: ${finalPayableAmount}`);
  }
  return roundCurrency((finalPayableAmount * advancePercent) / 100);
}

/**
 * Computes the still-owed balance against the frozen, GST-inclusive
 * finalPayableAmount snapshot, accounting for amounts already credited
 * toward this order (advance-ledger ORDER_PAYMENT consumption, bank-
 * transfer payment-proof approval, etc. — whatever the caller's own
 * authoritative source determines has already been applied; this module
 * never queries those tables itself, mirroring its "pure" contract).
 *
 * Mirrors apps/web/lib/order-outstanding.ts's Math.max(0, ...) floor
 * convention exactly, so a remaining balance is never reported as
 * negative (over-payment is a distinct concern this module does not
 * attempt to solve) and a creditedAmount is counted exactly once — callers
 * must pass the ALREADY-NET credited figure (e.g.
 * computeOrderOutstandingAmount's own advanceApplied, which itself nets
 * REFUND/REVERSAL against ORDER_PAYMENT) rather than re-summing raw ledger
 * rows here, so an advance reservation/consumption is never double-counted
 * against the same order.
 */
export function calculateRemainingBalance(finalPayableAmount: number, creditedAmount: number): number {
  if (!Number.isFinite(finalPayableAmount) || finalPayableAmount < 0) {
    throw new Error(`Invalid final payable amount for remaining-balance calculation: ${finalPayableAmount}`);
  }
  if (!Number.isFinite(creditedAmount)) {
    throw new Error(`Invalid credited amount for remaining-balance calculation: ${creditedAmount}`);
  }
  return Math.max(0, roundCurrency(finalPayableAmount - creditedAmount));
}
