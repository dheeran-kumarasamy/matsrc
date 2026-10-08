import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAX_RATE_PERCENT,
  estimateGstAmount,
  estimateGstInclusiveTotal,
  formatGstExclusiveNote,
  formatGstLineLabel,
} from "./gst-display";

// C29 — GST visibility only at checkout. See gst-display.ts's doc comment
// for the full investigation (prices are GST-exclusive everywhere before
// Cart/Checkout; every order resolves to the same platform-wide 18%
// default today — OrderItem.taxRatePercent is never populated by the
// cart -> checkout pipeline).

describe("estimateGstAmount — Test 2/3: GST-exclusive pricing visibility", () => {
  it("computes 18% of a GST-exclusive amount, matching the existing Cart/Checkout math", () => {
    // Existing Cart/Checkout: Math.round(subtotal * 0.18)
    expect(estimateGstAmount(10000)).toBe(Math.round(10000 * 0.18));
    expect(estimateGstAmount(10000)).toBe(1800);
  });

  // Test 5 — multiple quantities: GST scales linearly with the (already
  // quantity-multiplied) line subtotal passed in, never recomputed per-unit.
  it("scales correctly for a line subtotal reflecting quantity > 1", () => {
    const unitPrice = 425;
    const quantity = 100;
    const lineSubtotal = unitPrice * quantity; // 42500
    expect(estimateGstAmount(lineSubtotal)).toBe(Math.round(42500 * 0.18));
  });

  // Test 6 — price tiers: GST is computed from whatever subtotal the
  // caller passes (the already-resolved tier price), never a fixed/base
  // tier, so tier selection upstream is untouched.
  it("is agnostic to which tier produced the subtotal — just estimates GST on it", () => {
    const tierASubtotal = 100 * 450; // lower tier price
    const tierBSubtotal = 100 * 400; // bulk-discounted tier price
    expect(estimateGstAmount(tierASubtotal)).toBe(Math.round(tierASubtotal * 0.18));
    expect(estimateGstAmount(tierBSubtotal)).toBe(Math.round(tierBSubtotal * 0.18));
    expect(estimateGstAmount(tierASubtotal)).not.toBe(estimateGstAmount(tierBSubtotal));
  });

  // Test 10 — no fabricated GST: never negative, never NaN, never invented
  // for an invalid/zero amount.
  it("never fabricates a GST amount for non-finite, zero or negative input", () => {
    expect(estimateGstAmount(0)).toBe(0);
    expect(estimateGstAmount(-500)).toBe(0);
    expect(estimateGstAmount(NaN)).toBe(0);
    expect(estimateGstAmount(Infinity)).toBe(0);
  });
});

describe("estimateGstInclusiveTotal — Test 4: cart/checkout consistency", () => {
  it("equals subtotal + estimateGstAmount(subtotal), same shape as existing Cart/Checkout totals", () => {
    const subtotal = 10000;
    expect(estimateGstInclusiveTotal(subtotal)).toBe(subtotal + estimateGstAmount(subtotal));
    expect(estimateGstInclusiveTotal(subtotal)).toBe(11800);
  });

  it("returns 0 for non-positive/non-finite input, never a fabricated total", () => {
    expect(estimateGstInclusiveTotal(0)).toBe(0);
    expect(estimateGstInclusiveTotal(-10)).toBe(0);
  });
});

describe("formatGstExclusiveNote / formatGstLineLabel — Test 1/3: pre-checkout GST disclosure", () => {
  it("discloses the applicable GST rate without implying a single-tier rupee amount", () => {
    expect(formatGstExclusiveNote()).toBe(`+ GST (${DEFAULT_TAX_RATE_PERCENT}%)`);
  });

  it("labels the Cart/Checkout GST line using the same shared rate constant", () => {
    expect(formatGstLineLabel()).toBe(`GST (${DEFAULT_TAX_RATE_PERCENT}%)`);
  });
});

describe("DEFAULT_TAX_RATE_PERCENT — Test 7: multi-supplier consistency", () => {
  it("is the single platform-wide rate every listing resolves to today (no per-supplier override exists yet)", () => {
    // Documented in gst-display.ts: every OrderItem created by
    // apps/web/lib/order-checkout.ts omits taxRatePercent, so every
    // supplier's line item falls back to this exact same constant —
    // disclosing "18%" uniformly pre-cart is therefore not an arbitrary
    // merge of distinct suppliers' rates (S12 is unaffected: this constant
    // carries no supplier/order grouping information at all).
    expect(DEFAULT_TAX_RATE_PERCENT).toBe(18);
  });
});
