// §7 landed-cost tests. These lock the deterministic financial behaviour that
// the LLM is forbidden from performing itself.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TAX_RATE_PERCENT,
  calculateLandedCost,
  isComparableLandedCost,
} from "./landed-cost";

describe("calculateLandedCost — the spec's worked example", () => {
  // §7: Supplier A ₹355/bag + ₹6,000 freight for 500 bags = ₹183,500
  //     Supplier B ₹350/bag + ₹12,000 freight for 500 bags = ₹187,000
  // (tax excluded here so the figures match the spec exactly)
  it("reproduces Supplier A's ₹183,500 total", () => {
    const result = calculateLandedCost({
      quantity: 500,
      unitMaterialPrice: 355,
      freightCost: 6000,
      deliveryCharges: 0,
      handlingCharges: 0,
      includeTax: false,
    });

    expect(result.materialCost).toBe(177500);
    expect(result.freightCost).toBe(6000);
    expect(result.estimatedLandedCost).toBe(183500);
    expect(result.unitLandedCost).toBe(367);
    expect(result.taxAmount).toBeNull();
  });

  it("reproduces Supplier B's ₹187,000 total", () => {
    const result = calculateLandedCost({
      quantity: 500,
      unitMaterialPrice: 350,
      freightCost: 12000,
      deliveryCharges: 0,
      handlingCharges: 0,
      includeTax: false,
    });

    expect(result.materialCost).toBe(175000);
    expect(result.estimatedLandedCost).toBe(187000);
    expect(result.unitLandedCost).toBe(374);
  });

  it("shows the cheaper unit price does NOT mean the cheaper delivered total", () => {
    const supplierA = calculateLandedCost({
      quantity: 500,
      unitMaterialPrice: 355,
      freightCost: 6000,
      includeTax: false,
    });
    const supplierB = calculateLandedCost({
      quantity: 500,
      unitMaterialPrice: 350,
      freightCost: 12000,
      includeTax: false,
    });

    // B has the lower ₹/bag...
    expect(supplierB.unitMaterialPrice!).toBeLessThan(supplierA.unitMaterialPrice!);
    // ...but A is cheaper overall.
    expect(supplierA.estimatedLandedCost!).toBeLessThan(supplierB.estimatedLandedCost!);
  });
});

describe("calculateLandedCost — tax handling", () => {
  it("applies the platform default GST rate and records the assumption", () => {
    const result = calculateLandedCost({
      quantity: 100,
      unitMaterialPrice: 100,
      freightCost: 0,
      deliveryCharges: 0,
      handlingCharges: 0,
    });

    expect(result.taxAmount).toBe(1800);
    expect(result.estimatedLandedCost).toBe(11800);
    expect(result.assumptions).toContain(
      `taxRatePercent=${DEFAULT_TAX_RATE_PERCENT} (platform default)`
    );
  });

  it("uses an explicit product tax rate when one is known", () => {
    const result = calculateLandedCost({
      quantity: 100,
      unitMaterialPrice: 100,
      freightCost: 0,
      deliveryCharges: 0,
      handlingCharges: 0,
      taxRatePercent: 28,
    });

    expect(result.taxAmount).toBe(2800);
    expect(result.assumptions).toEqual([]);
  });

  it("taxes the freight-inclusive subtotal, not just the material", () => {
    const result = calculateLandedCost({
      quantity: 10,
      unitMaterialPrice: 100,
      freightCost: 1000,
      deliveryCharges: 0,
      handlingCharges: 0,
      taxRatePercent: 10,
    });

    // subtotal = 1000 + 1000 = 2000, tax = 200
    expect(result.taxAmount).toBe(200);
    expect(result.estimatedLandedCost).toBe(2200);
  });
});

describe("calculateLandedCost — missing data is never zero-filled", () => {
  it("returns NO landed cost when the unit price is unavailable", () => {
    const result = calculateLandedCost({ quantity: 500, unitMaterialPrice: null });

    expect(result.estimatedLandedCost).toBeNull();
    expect(result.unitLandedCost).toBeNull();
    expect(result.materialCost).toBeNull();
    expect(result.dataGaps).toContain("unitMaterialPrice");
  });

  it("excludes unavailable freight from the total and flags the gap", () => {
    const result = calculateLandedCost({
      quantity: 500,
      unitMaterialPrice: 355,
      freightCost: null,
      deliveryCharges: 0,
      handlingCharges: 0,
      includeTax: false,
    });

    expect(result.freightCost).toBeNull();
    // The total is material-only, and that incompleteness is explicit.
    expect(result.estimatedLandedCost).toBe(177500);
    expect(result.dataGaps).toContain("freight");
    expect(isComparableLandedCost(result)).toBe(false);
  });

  it("treats a freight-inclusive total as comparable", () => {
    const result = calculateLandedCost({
      quantity: 500,
      unitMaterialPrice: 355,
      freightCost: 6000,
      deliveryCharges: 0,
      handlingCharges: 0,
    });
    expect(isComparableLandedCost(result)).toBe(true);
  });

  it("rejects a zero/negative quantity rather than producing a bogus total", () => {
    expect(calculateLandedCost({ quantity: 0, unitMaterialPrice: 355 }).estimatedLandedCost).toBeNull();
    expect(calculateLandedCost({ quantity: -5, unitMaterialPrice: 355 }).estimatedLandedCost).toBeNull();
  });

  it("ignores negative charge inputs instead of subtracting them", () => {
    const result = calculateLandedCost({
      quantity: 10,
      unitMaterialPrice: 100,
      freightCost: -500,
      includeTax: false,
    });
    expect(result.freightCost).toBeNull();
    expect(result.dataGaps).toContain("freight");
    expect(result.estimatedLandedCost).toBe(1000);
  });
});
