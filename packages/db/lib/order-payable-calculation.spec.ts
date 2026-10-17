import { describe, expect, it } from "vitest";
import {
  calculateOrderPayableLine,
  calculateOrderPayableTotals,
  calculateRemainingBalance,
  calculateRequiredAdvanceAmount,
  isValidAdvancePercent,
  isValidQuantity,
} from "./order-payable-calculation";

describe("calculateOrderPayableLine", () => {
  it("applies markup exactly once, then calculates GST on the marked-up buyer value", () => {
    // Supplier ₹1000, 10% markup -> buyerUnitPrice 1100; 18% GST on
    // 1100 * 2 = 2200 -> tax 396, lineTotal 2596.
    const result = calculateOrderPayableLine({
      supplierUnitPrice: 1000,
      markupPercent: 10,
      taxRatePercent: 18,
      quantity: 2,
    });
    expect(result.supplierUnitPrice).toBe(1000);
    expect(result.buyerUnitPrice).toBe(1100);
    expect(result.markupAmount).toBe(100);
    expect(result.lineTaxableValue).toBe(2200);
    expect(result.taxAmount).toBe(396);
    expect(result.lineTotal).toBe(2596);
  });

  it("never computes GST on the original (pre-markup) supplier price", () => {
    const result = calculateOrderPayableLine({
      supplierUnitPrice: 1000,
      markupPercent: 10,
      taxRatePercent: 18,
      quantity: 1,
    });
    // If GST were wrongly computed on supplierUnitPrice (1000), tax would be
    // 180 and lineTaxableValue 1000 — assert the actual marked-up values.
    expect(result.lineTaxableValue).toBe(1100);
    expect(result.taxAmount).toBe(198);
    expect(result.taxAmount).not.toBe(180);
  });

  it("preserves the original supplier price distinct from the buyer price", () => {
    const result = calculateOrderPayableLine({
      supplierUnitPrice: 500,
      markupPercent: 20,
      taxRatePercent: 12,
      quantity: 3,
    });
    expect(result.supplierUnitPrice).toBe(500);
    expect(result.buyerUnitPrice).toBe(600);
    expect(result.supplierUnitPrice).not.toBe(result.buyerUnitPrice);
  });

  it("treats an explicit 0% GST rate as a genuine zero-tax line", () => {
    const result = calculateOrderPayableLine({
      supplierUnitPrice: 1000,
      markupPercent: 0,
      taxRatePercent: 0,
      quantity: 1,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.lineTotal).toBe(result.lineTaxableValue);
  });

  it("avoids floating-point drift for fractional prices and percentages", () => {
    const result = calculateOrderPayableLine({
      supplierUnitPrice: 77.77,
      markupPercent: 12.5,
      taxRatePercent: 18,
      quantity: 3,
    });
    // buyerUnitPrice = 87.49 (from markup-calculation.spec.ts's own case);
    // lineTaxableValue = 87.49 * 3 = 262.47; tax = 262.47*0.18 = 47.2446.
    expect(result.buyerUnitPrice).toBe(87.49);
    expect(result.lineTaxableValue).toBe(262.47);
    expect(result.taxAmount).toBeCloseTo(47.24, 2);
  });

  it("throws on zero or fractional quantity", () => {
    expect(() =>
      calculateOrderPayableLine({ supplierUnitPrice: 100, markupPercent: 10, taxRatePercent: 18, quantity: 0 })
    ).toThrow();
    expect(() =>
      calculateOrderPayableLine({ supplierUnitPrice: 100, markupPercent: 10, taxRatePercent: 18, quantity: 1.5 })
    ).toThrow();
  });

  it("throws on negative/NaN/Infinity tax rate", () => {
    expect(() =>
      calculateOrderPayableLine({ supplierUnitPrice: 100, markupPercent: 10, taxRatePercent: -5, quantity: 1 })
    ).toThrow();
    expect(() =>
      calculateOrderPayableLine({ supplierUnitPrice: 100, markupPercent: 10, taxRatePercent: NaN, quantity: 1 })
    ).toThrow();
    expect(() =>
      calculateOrderPayableLine({ supplierUnitPrice: 100, markupPercent: 10, taxRatePercent: Infinity, quantity: 1 })
    ).toThrow();
  });

  it("throws on invalid supplier price or markup percent (delegated to calculateMarkup)", () => {
    expect(() =>
      calculateOrderPayableLine({ supplierUnitPrice: -10, markupPercent: 10, taxRatePercent: 18, quantity: 1 })
    ).toThrow();
    expect(() =>
      calculateOrderPayableLine({ supplierUnitPrice: 100, markupPercent: -5, taxRatePercent: 18, quantity: 1 })
    ).toThrow();
  });
});

describe("calculateOrderPayableTotals", () => {
  it("sums multiple lines into subtotal/taxAmount/finalPayableAmount, reconciling exactly", () => {
    const totals = calculateOrderPayableTotals([
      { supplierUnitPrice: 1000, markupPercent: 10, taxRatePercent: 18, quantity: 2 }, // 2200 / 396 / 2596
      { supplierUnitPrice: 500, markupPercent: 20, taxRatePercent: 12, quantity: 3 }, // 1800 / 216 / 2016
    ]);
    expect(totals.lines).toHaveLength(2);
    expect(totals.subtotal).toBe(2200 + 1800);
    expect(totals.taxAmount).toBe(396 + 216);
    expect(totals.finalPayableAmount).toBe(totals.subtotal + totals.taxAmount);
    const sumOfLineTotals = totals.lines.reduce((sum, l) => sum + l.lineTotal, 0);
    expect(totals.finalPayableAmount).toBeCloseTo(sumOfLineTotals, 2);
  });

  it("supports independently-taxed lines at different GST rates", () => {
    const totals = calculateOrderPayableTotals([
      { supplierUnitPrice: 400, markupPercent: 0, taxRatePercent: 18, quantity: 100 },
      { supplierUnitPrice: 2000, markupPercent: 0, taxRatePercent: 5, quantity: 10 },
    ]);
    expect(totals.subtotal).toBe(40000 + 20000);
    expect(totals.taxAmount).toBe(7200 + 1000);
  });

  it("returns zeroed totals for an empty line list", () => {
    const totals = calculateOrderPayableTotals([]);
    expect(totals).toEqual({ lines: [], subtotal: 0, taxAmount: 0, finalPayableAmount: 0 });
  });

  it("is stable across many lines with fractional prices (rounding boundary check)", () => {
    const lines = Array.from({ length: 7 }, (_, i) => ({
      supplierUnitPrice: 33.33 + i,
      markupPercent: 7.5,
      taxRatePercent: 18,
      quantity: i + 1,
    }));
    const totals = calculateOrderPayableTotals(lines);
    const expectedSubtotal = totals.lines.reduce((sum, l) => sum + l.lineTaxableValue, 0);
    const expectedTax = totals.lines.reduce((sum, l) => sum + l.taxAmount, 0);
    expect(totals.subtotal).toBeCloseTo(expectedSubtotal, 2);
    expect(totals.taxAmount).toBeCloseTo(expectedTax, 2);
    expect(totals.finalPayableAmount).toBeCloseTo(totals.subtotal + totals.taxAmount, 2);
  });

  it("propagates a single invalid line's error for the whole order (fails deterministically)", () => {
    expect(() =>
      calculateOrderPayableTotals([
        { supplierUnitPrice: 1000, markupPercent: 10, taxRatePercent: 18, quantity: 1 },
        { supplierUnitPrice: -5, markupPercent: 10, taxRatePercent: 18, quantity: 1 },
      ])
    ).toThrow();
  });
});

describe("calculateRequiredAdvanceAmount", () => {
  it("computes the required advance from the GST-INCLUSIVE final payable, not the subtotal", () => {
    const result = calculateRequiredAdvanceAmount(2596, 20);
    expect(result).toBe(519.2);
  });

  it("returns null (never 0) when advancePercent is null or undefined", () => {
    expect(calculateRequiredAdvanceAmount(2596, null)).toBeNull();
    expect(calculateRequiredAdvanceAmount(2596, undefined)).toBeNull();
  });

  it("honours an explicit 0% advance percentage as a genuine zero-advance result", () => {
    expect(calculateRequiredAdvanceAmount(2596, 0)).toBe(0);
  });

  it("throws on a negative or non-finite advance percentage", () => {
    expect(() => calculateRequiredAdvanceAmount(2596, -10)).toThrow();
    expect(() => calculateRequiredAdvanceAmount(2596, NaN)).toThrow();
    expect(() => calculateRequiredAdvanceAmount(2596, Infinity)).toThrow();
  });

  it("throws on a negative or non-finite final payable amount", () => {
    expect(() => calculateRequiredAdvanceAmount(-100, 20)).toThrow();
    expect(() => calculateRequiredAdvanceAmount(NaN, 20)).toThrow();
  });
});

describe("calculateRemainingBalance", () => {
  it("subtracts credited amount from the final payable snapshot without double-counting", () => {
    expect(calculateRemainingBalance(2596, 519.2)).toBe(2076.8);
  });

  it("floors at 0 rather than going negative when credited exceeds payable", () => {
    expect(calculateRemainingBalance(1000, 1500)).toBe(0);
  });

  it("returns the full final payable when nothing has been credited", () => {
    expect(calculateRemainingBalance(2596, 0)).toBe(2596);
  });

  it("returns 0 when the order has been fully paid", () => {
    expect(calculateRemainingBalance(2596, 2596)).toBe(0);
  });

  it("throws on negative or non-finite final payable amount", () => {
    expect(() => calculateRemainingBalance(-100, 0)).toThrow();
    expect(() => calculateRemainingBalance(NaN, 0)).toThrow();
  });

  it("throws on non-finite credited amount", () => {
    expect(() => calculateRemainingBalance(1000, NaN)).toThrow();
    expect(() => calculateRemainingBalance(1000, Infinity)).toThrow();
  });
});

describe("isValidQuantity / isValidAdvancePercent", () => {
  it("isValidQuantity rejects zero, negative, fractional, NaN, and Infinity", () => {
    expect(isValidQuantity(0)).toBe(false);
    expect(isValidQuantity(-1)).toBe(false);
    expect(isValidQuantity(1.5)).toBe(false);
    expect(isValidQuantity(NaN)).toBe(false);
    expect(isValidQuantity(Infinity)).toBe(false);
  });

  it("isValidQuantity accepts positive integers", () => {
    expect(isValidQuantity(1)).toBe(true);
    expect(isValidQuantity(100)).toBe(true);
  });

  it("isValidAdvancePercent rejects negative/NaN/Infinity and accepts zero/positive", () => {
    expect(isValidAdvancePercent(-1)).toBe(false);
    expect(isValidAdvancePercent(NaN)).toBe(false);
    expect(isValidAdvancePercent(Infinity)).toBe(false);
    expect(isValidAdvancePercent(0)).toBe(true);
    expect(isValidAdvancePercent(20)).toBe(true);
  });
});
