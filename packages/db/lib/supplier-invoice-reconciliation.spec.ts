import { describe, it, expect } from "vitest";
import { resolveSupplierInvoiceLine, aggregateSupplierInvoiceTotals } from "./supplier-invoice-reconciliation";

describe("resolveSupplierInvoiceLine", () => {
  it("uses the agreed rate when only the actual quantity/weight differs (no rate change)", () => {
    const result = resolveSupplierInvoiceLine({
      originalQuantity: 1000,
      originalUnitPrice: 45,
      actualQuantity: 1023.5,
      supplierInvoicedUnitPrice: null,
      taxRatePercent: 18,
    });

    expect(result.approvedUnitPrice).toBe(45);
    expect(result.rateDiscrepancy).toBe(false);
    expect(result.lineSubtotal).toBe(1023.5 * 45);
    expect(result.lineTaxAmount).toBeCloseTo(1023.5 * 45 * 0.18, 2);
    expect(result.lineTotal).toBeCloseTo(1023.5 * 45 * 1.18, 2);
  });

  it("flags a rate discrepancy when the supplier-invoiced rate differs from the agreed rate", () => {
    const result = resolveSupplierInvoiceLine({
      originalQuantity: 1000,
      originalUnitPrice: 45,
      actualQuantity: 1000,
      supplierInvoicedUnitPrice: 47,
      taxRatePercent: 18,
    });

    expect(result.rateDiscrepancy).toBe(true);
    // Never silently uses the supplier's rate without an explicit admin override.
    expect(result.approvedUnitPrice).toBe(45);
  });

  it("never flags a discrepancy for negligible (rounding-level) rate differences", () => {
    const result = resolveSupplierInvoiceLine({
      originalQuantity: 100,
      originalUnitPrice: 45,
      actualQuantity: 100,
      supplierInvoicedUnitPrice: 45.005,
      taxRatePercent: 18,
    });

    expect(result.rateDiscrepancy).toBe(false);
  });

  it("applies an explicit admin-approved rate override, never inferred automatically", () => {
    const result = resolveSupplierInvoiceLine({
      originalQuantity: 1000,
      originalUnitPrice: 45,
      actualQuantity: 1000,
      supplierInvoicedUnitPrice: 47,
      approvedUnitPriceOverride: 47,
      taxRatePercent: 18,
    });

    expect(result.rateDiscrepancy).toBe(true);
    expect(result.approvedUnitPrice).toBe(47);
    expect(result.lineSubtotal).toBe(47000);
  });

  it("falls back to DEFAULT_TAX_RATE_PERCENT when no taxRatePercent is supplied", () => {
    const result = resolveSupplierInvoiceLine({
      originalQuantity: 10,
      originalUnitPrice: 100,
      actualQuantity: 10,
      taxRatePercent: null,
    });

    expect(result.taxRatePercent).toBe(18);
    expect(result.lineTaxAmount).toBe(180);
  });

  it("honours an explicit 0% tax rate as genuinely tax-free, never substituting the default", () => {
    const result = resolveSupplierInvoiceLine({
      originalQuantity: 10,
      originalUnitPrice: 100,
      actualQuantity: 10,
      taxRatePercent: 0,
    });

    expect(result.lineTaxAmount).toBe(0);
    expect(result.lineTotal).toBe(1000);
  });
});

describe("aggregateSupplierInvoiceTotals", () => {
  it("sums confirmed line subtotals/tax with no adjustments", () => {
    const lines = [
      resolveSupplierInvoiceLine({ originalQuantity: 10, originalUnitPrice: 100, actualQuantity: 10, taxRatePercent: 18 }),
      resolveSupplierInvoiceLine({ originalQuantity: 5, originalUnitPrice: 200, actualQuantity: 5, taxRatePercent: 18 }),
    ];

    const totals = aggregateSupplierInvoiceTotals(lines);
    expect(totals.taxableValue).toBe(2000);
    expect(totals.taxAmount).toBe(360);
    expect(totals.totalAmount).toBe(2360);
  });

  it("adds freight/other charges, subtracts discount, and applies rounding last", () => {
    const lines = [resolveSupplierInvoiceLine({ originalQuantity: 10, originalUnitPrice: 100, actualQuantity: 10, taxRatePercent: 18 })];

    const totals = aggregateSupplierInvoiceTotals(lines, {
      freightChargeAmount: 50,
      otherChargesAmount: 10,
      discountAmount: 20,
      roundingAdjustment: -0.5,
    });

    // taxableValue = 1000 + 50 + 10 - 20 = 1040; tax stays line-derived = 180
    expect(totals.taxableValue).toBe(1040);
    expect(totals.taxAmount).toBe(180);
    // total = 1040 + 180 - 0.5
    expect(totals.totalAmount).toBe(1219.5);
  });
});
