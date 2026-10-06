import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAX_RATE_PERCENT,
  aggregateQuotationTotals,
  calculateLineGst,
  isValidQuotedPrice,
  parseQuotedPrice,
  roundCurrency,
} from "./gst-calculation";

describe("calculateLineGst", () => {
  // Test 1 — Supplier can edit price
  it("computes the line subtotal from the supplier-entered unit price", () => {
    const result = calculateLineGst({ quantity: 100, unitPrice: 425, gstRatePercent: 0 });
    expect(result.lineSubtotal).toBe(42500);
  });

  // Test 2 — GST calculation
  it("computes subtotal, GST and total for a single line item", () => {
    const result = calculateLineGst({ quantity: 100, unitPrice: 425, gstRatePercent: 18 });
    expect(result.lineSubtotal).toBe(42500);
    expect(result.gstAmount).toBe(7650);
    expect(result.lineTotal).toBe(50150);
  });

  // Test 4 — GST not applicable
  it("treats an explicit 0% GST rate as a genuine zero-tax line", () => {
    const result = calculateLineGst({ quantity: 100, unitPrice: 500, gstRatePercent: 0 });
    expect(result.lineSubtotal).toBe(50000);
    expect(result.gstAmount).toBe(0);
    expect(result.lineTotal).toBe(50000);
  });

  it("falls back to DEFAULT_TAX_RATE_PERCENT when gstRatePercent is null/undefined", () => {
    const resultNull = calculateLineGst({ quantity: 10, unitPrice: 100, gstRatePercent: null });
    const resultUndefined = calculateLineGst({ quantity: 10, unitPrice: 100 });
    expect(resultNull.gstRatePercent).toBe(DEFAULT_TAX_RATE_PERCENT);
    expect(resultUndefined.gstRatePercent).toBe(DEFAULT_TAX_RATE_PERCENT);
  });

  it("avoids floating-point drift for odd decimal unit prices", () => {
    const result = calculateLineGst({ quantity: 3, unitPrice: 77.77, gstRatePercent: 18 });
    expect(result.lineSubtotal).toBe(233.31);
    expect(result.gstAmount).toBe(roundCurrency(41.9958));
    expect(result.lineTotal).toBe(roundCurrency(233.31 + roundCurrency(41.9958)));
  });
});

// Test 3 — Multiple GST rates
describe("aggregateQuotationTotals", () => {
  it("aggregates independently-taxed line items into quotation-level totals", () => {
    const itemA = calculateLineGst({ quantity: 100, unitPrice: 400, gstRatePercent: 18 });
    const itemB = calculateLineGst({ quantity: 10, unitPrice: 2000, gstRatePercent: 5 });

    expect(itemA.lineSubtotal).toBe(40000);
    expect(itemA.gstAmount).toBe(7200);
    expect(itemB.lineSubtotal).toBe(20000);
    expect(itemB.gstAmount).toBe(1000);

    const totals = aggregateQuotationTotals([itemA, itemB]);
    expect(totals.subtotal).toBe(60000);
    expect(totals.gstAmount).toBe(8200);
    expect(totals.grandTotal).toBe(68200);
  });

  it("returns zeroed totals for an empty line list", () => {
    const totals = aggregateQuotationTotals([]);
    expect(totals).toEqual({ subtotal: 0, gstAmount: 0, grandTotal: 0 });
  });
});

describe("isValidQuotedPrice / parseQuotedPrice", () => {
  // Test 5 — Negative price
  it("rejects negative numbers", () => {
    expect(isValidQuotedPrice(-100)).toBe(false);
    expect(parseQuotedPrice("-100")).toBeNull();
  });

  // Test 6 — Invalid price
  it("rejects non-numeric input", () => {
    expect(parseQuotedPrice("abc")).toBeNull();
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidQuotedPrice(NaN)).toBe(false);
    expect(isValidQuotedPrice(Infinity)).toBe(false);
    expect(isValidQuotedPrice(-Infinity)).toBe(false);
  });

  it("rejects empty/missing input", () => {
    expect(parseQuotedPrice("")).toBeNull();
    expect(parseQuotedPrice(null)).toBeNull();
    expect(parseQuotedPrice(undefined)).toBeNull();
  });

  it("accepts zero and positive finite numbers", () => {
    expect(isValidQuotedPrice(0)).toBe(true);
    expect(parseQuotedPrice("0")).toBe(0);
    expect(parseQuotedPrice("425.50")).toBe(425.5);
  });
});
