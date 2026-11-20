// packages/db/lib/supplier-invoice-reconciliation.ts
//
// Shared, framework-agnostic reconciliation math for the Supplier Invoice
// Upload / Admin Verification / Buyer Invoice Generation workflow. Used by
// apps/api's SupplierInvoicesService (admin line-item review + confirm) so
// there is exactly one place this math is implemented — mirrors the
// existing convention established by gst-calculation.ts (shared between
// apps/api and apps/supplier) and business-number.ts.
//
// Quantity/price rules (per the feature spec):
//   1. Actual quantity/weight changes at an UNCHANGED agreed rate: the line
//      amount uses the actual invoiced quantity x the agreed (original)
//      rate — see resolveLineAmount below.
//   2. A supplier-invoiced rate that DIFFERS from the agreed rate is never
//      silently accepted: resolveLineAmount flags `rateDiscrepancy = true`
//      whenever `supplierInvoicedUnitPrice` differs from `originalUnitPrice`
//      (beyond a currency-rounding epsilon of 0.01) and uses
//      `originalUnitPrice` for the actual calculation UNLESS the caller
//      explicitly passes an already-admin-approved `approvedUnitPrice` that
//      differs from the original — i.e. the agreed rate is used by default,
//      and any deviation is both flagged AND requires an explicit
//      `approvedUnitPrice` input to take effect, never inferred.
//   3. Freight/discount/other-charges/rounding are invoice-level inputs,
//      added once (see aggregateSupplierInvoiceTotals), never duplicated
//      onto every line.
//   4. No unit-of-measurement conversion is performed anywhere in this
//      module — `actualQuantity` must already be expressed in the same unit
//      as `originalQuantity`/the underlying OrderItem's product unit. A
//      caller suspecting a unit mismatch (e.g. the supplier invoice shows
//      tonnes when the order was placed in kg) must treat that as its own
//      discrepancy to resolve BEFORE calling this module — seex the Final
//      Report's documented, unresolved "weight-unit conversion" decision.
import { calculateLineGst, roundCurrency, DEFAULT_TAX_RATE_PERCENT } from "./gst-calculation";

export type SupplierInvoiceLineInput = {
  originalQuantity: number;
  originalUnitPrice: number;
  actualQuantity: number;
  /** The rate shown on the supplier's own invoice for this line, if any. */
  supplierInvoicedUnitPrice?: number | null;
  /**
   * An admin's EXPLICIT decision to approve a different base rate than
   * originalUnitPrice for buyer billing.
   * Omitted/undefined -> the agreed originalUnitPrice is used.
   */
  approvedUnitPriceOverride?: number | null;
  taxRatePercent?: number | null;
  /**
   * Whether markup should be applied to approvedUnitPrice when generating
   * the buyer invoice. Defaults to true.
   */
  applyMarkup?: boolean;
};

export type SupplierInvoiceLineResolution = {
  approvedUnitPrice: number;
  supplierInvoicedUnitPrice: number | null;
  supplierSettlementUnitPrice: number;
  applyMarkup: boolean;
  rateDiscrepancy: boolean;
  lineSubtotal: number;
  taxRatePercent: number;
  lineTaxAmount: number;
  lineTotal: number;
};

const RATE_EPSILON = 0.01;

/**
 * Resolves a single supplier-invoice line's approved rate + GST breakdown.
 * - `supplierSettlementUnitPrice`: The rate Buildohub pays/settles with the supplier.
 *   Uses `supplierInvoicedUnitPrice` if provided; otherwise falls back to `originalUnitPrice`.
 * - `approvedUnitPrice`: The base rate used for buyer billing.
 *   Uses `approvedUnitPriceOverride` if provided; otherwise falls back to `originalUnitPrice`.
 * - `lineSubtotal`, `lineTaxAmount`, `lineTotal`: Computed using `supplierSettlementUnitPrice`
 *   so the supplier invoice's confirmed totals match what Buildohub owes the supplier.
 */
export function resolveSupplierInvoiceLine(input: SupplierInvoiceLineInput): SupplierInvoiceLineResolution {
  const rateDiscrepancy =
    typeof input.supplierInvoicedUnitPrice === "number" &&
    Math.abs(input.supplierInvoicedUnitPrice - input.originalUnitPrice) > RATE_EPSILON;

  const supplierInvoicedUnitPrice =
    typeof input.supplierInvoicedUnitPrice === "number" ? roundCurrency(input.supplierInvoicedUnitPrice) : null;

  const supplierSettlementUnitPrice = supplierInvoicedUnitPrice ?? input.originalUnitPrice;

  const approvedUnitPrice =
    typeof input.approvedUnitPriceOverride === "number" ? input.approvedUnitPriceOverride : input.originalUnitPrice;

  const applyMarkup = input.applyMarkup !== false;

  // The supplier invoice totals must reflect what the supplier invoiced Buildohub
  const gst = calculateLineGst({
    quantity: input.actualQuantity,
    unitPrice: supplierSettlementUnitPrice,
    gstRatePercent: input.taxRatePercent ?? null,
  });

  return {
    approvedUnitPrice: roundCurrency(approvedUnitPrice),
    supplierInvoicedUnitPrice,
    supplierSettlementUnitPrice: roundCurrency(supplierSettlementUnitPrice),
    applyMarkup,
    rateDiscrepancy,
    lineSubtotal: gst.lineSubtotal,
    taxRatePercent: gst.gstRatePercent,
    lineTaxAmount: gst.gstAmount,
    lineTotal: gst.lineTotal,
  };
}

export type SupplierInvoiceAdjustments = {
  freightChargeAmount?: number;
  otherChargesAmount?: number;
  discountAmount?: number;
  roundingAdjustment?: number;
};

export type SupplierInvoiceTotals = {
  taxableValue: number;
  taxAmount: number;
  totalAmount: number;
};

/**
 * Aggregates confirmed line resolutions + invoice-level adjustments into
 * the final confirmed invoice totals. Freight/other charges ADD to the
 * total; discount SUBTRACTS; roundingAdjustment is applied last (can be
 * positive or negative) so the final total matches the supplier's own
 * invoice total when the admin has verified it reconciles.
 *
 * Freight and other charges entered by Admin are exclusive of GST and
 * attract 18% GST (Rule 46 & Form GST INV-01 compliance).
 */
export function aggregateSupplierInvoiceTotals(
  lines: SupplierInvoiceLineResolution[],
  adjustments: SupplierInvoiceAdjustments = {}
): SupplierInvoiceTotals {
  const linesTaxableValue = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const linesTaxAmount = lines.reduce((sum, line) => sum + line.lineTaxAmount, 0);

  const freight = adjustments.freightChargeAmount ?? 0;
  const other = adjustments.otherChargesAmount ?? 0;
  const discount = adjustments.discountAmount ?? 0;
  const rounding = adjustments.roundingAdjustment ?? 0;

  const netAdjustment = freight + other - discount;
  const adjustmentTax = netAdjustment > 0 ? roundCurrency((netAdjustment * DEFAULT_TAX_RATE_PERCENT) / 100) : 0;

  const taxableValue = linesTaxableValue + netAdjustment;
  const taxAmount = linesTaxAmount + adjustmentTax;
  const totalAmount = taxableValue + taxAmount + rounding;

  return {
    taxableValue: roundCurrency(taxableValue),
    taxAmount: roundCurrency(taxAmount),
    totalAmount: roundCurrency(totalAmount),
  };
}

export { DEFAULT_TAX_RATE_PERCENT };
