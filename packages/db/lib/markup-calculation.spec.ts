import { describe, expect, it } from "vitest";
import {
  calculateMarkup,
  isValidMarkupPercent,
  isValidSupplierPrice,
  resolveAndCalculateMarkup,
  resolveEffectiveMarkupPercent,
  resolveMarkupForProduct,
} from "./markup-calculation";

describe("calculateMarkup", () => {
  it("computes the canonical example: ₹1,000 supplier price, 10% markup", () => {
    const result = calculateMarkup({ supplierUnitPrice: 1000, markupPercent: 10 });
    expect(result.supplierUnitPrice).toBe(1000);
    expect(result.buyerUnitPrice).toBe(1100);
    expect(result.markupAmount).toBe(100);
  });

  it("treats an explicit 0% markup as a genuine no-markup line", () => {
    const result = calculateMarkup({ supplierUnitPrice: 1000, markupPercent: 0 });
    expect(result.buyerUnitPrice).toBe(1000);
    expect(result.markupAmount).toBe(0);
  });

  it("computes a 1% markup correctly", () => {
    const result = calculateMarkup({ supplierUnitPrice: 2000, markupPercent: 1 });
    expect(result.buyerUnitPrice).toBe(2020);
    expect(result.markupAmount).toBe(20);
  });

  it("computes a 25% markup correctly", () => {
    const result = calculateMarkup({ supplierUnitPrice: 400, markupPercent: 25 });
    expect(result.buyerUnitPrice).toBe(500);
    expect(result.markupAmount).toBe(100);
  });

  it("supports markup percentages above 100% (no ceiling enforced)", () => {
    const result = calculateMarkup({ supplierUnitPrice: 100, markupPercent: 150 });
    expect(result.buyerUnitPrice).toBe(250);
    expect(result.markupAmount).toBe(150);
  });

  it("avoids floating-point drift for fractional supplier prices", () => {
    const result = calculateMarkup({ supplierUnitPrice: 77.77, markupPercent: 12.5 });
    expect(result.buyerUnitPrice).toBe(87.49);
    expect(result.markupAmount).toBe(9.72);
  });

  it("never applies markup to an already-marked-up price (single-pass by construction)", () => {
    // Calling calculateMarkup a second time on its own output would be a
    // caller bug (double markup) — demonstrate that feeding the ORIGINAL
    // price twice (idempotent re-resolution, e.g. a retried request) always
    // produces the SAME result rather than compounding.
    const first = calculateMarkup({ supplierUnitPrice: 1000, markupPercent: 10 });
    const second = calculateMarkup({ supplierUnitPrice: 1000, markupPercent: 10 });
    expect(second).toEqual(first);
    // Explicitly demonstrate the double-markup failure this guards against:
    // feeding the BUYER price back in as if it were the supplier price
    // produces a visibly different (wrong) result, which is exactly why
    // every call site must only ever pass the ORIGINAL supplier price.
    const doubled = calculateMarkup({ supplierUnitPrice: first.buyerUnitPrice, markupPercent: 10 });
    expect(doubled.buyerUnitPrice).not.toBe(first.buyerUnitPrice);
    expect(doubled.buyerUnitPrice).toBe(1210);
  });

  it("throws on a negative supplier price rather than silently coercing to zero", () => {
    expect(() => calculateMarkup({ supplierUnitPrice: -10, markupPercent: 10 })).toThrow();
  });

  it("throws on NaN/Infinity supplier price or markup percent", () => {
    expect(() => calculateMarkup({ supplierUnitPrice: NaN, markupPercent: 10 })).toThrow();
    expect(() => calculateMarkup({ supplierUnitPrice: 100, markupPercent: Infinity })).toThrow();
  });

  it("throws on a negative markup percentage", () => {
    expect(() => calculateMarkup({ supplierUnitPrice: 100, markupPercent: -5 })).toThrow();
  });
});

describe("multiple products with different markups and quantities", () => {
  it("computes independent line values for the canonical quantity-5 example", () => {
    const quantity = 5;
    const result = calculateMarkup({ supplierUnitPrice: 1000, markupPercent: 10 });
    expect(result.supplierUnitPrice * quantity).toBe(5000);
    expect(result.buyerUnitPrice * quantity).toBe(5500);
    expect(result.markupAmount * quantity).toBe(500);
  });

  it("applies different markups to different products independently", () => {
    const productA = calculateMarkup({ supplierUnitPrice: 1000, markupPercent: 10 });
    const productB = calculateMarkup({ supplierUnitPrice: 2000, markupPercent: 25 });
    expect(productA.buyerUnitPrice).toBe(1100);
    expect(productB.buyerUnitPrice).toBe(2500);
  });
});

describe("resolveEffectiveMarkupPercent (precedence)", () => {
  it("prefers the product override over category and global", () => {
    const resolved = resolveEffectiveMarkupPercent({
      product: { percentage: 5, isEnabled: true },
      category: { percentage: 15, isEnabled: true },
      global: { percentage: 10, isEnabled: true },
    });
    expect(resolved).toBe(5);
  });

  it("falls through to category when no product override exists", () => {
    const resolved = resolveEffectiveMarkupPercent({
      product: null,
      category: { percentage: 15, isEnabled: true },
      global: { percentage: 10, isEnabled: true },
    });
    expect(resolved).toBe(15);
  });

  it("falls through to global when neither product nor category exist", () => {
    const resolved = resolveEffectiveMarkupPercent({
      product: null,
      category: null,
      global: { percentage: 10, isEnabled: true },
    });
    expect(resolved).toBe(10);
  });

  it("treats a disabled product override as unset and falls through to category", () => {
    const resolved = resolveEffectiveMarkupPercent({
      product: { percentage: 5, isEnabled: false },
      category: { percentage: 15, isEnabled: true },
      global: { percentage: 10, isEnabled: true },
    });
    expect(resolved).toBe(15);
  });

  it("honours an explicit, enabled 0% product override distinctly from unset", () => {
    const resolved = resolveEffectiveMarkupPercent({
      product: { percentage: 0, isEnabled: true },
      category: { percentage: 15, isEnabled: true },
      global: { percentage: 10, isEnabled: true },
    });
    expect(resolved).toBe(0);
  });

  it("returns null (never 0) when no tier has an enabled setting", () => {
    const resolved = resolveEffectiveMarkupPercent({
      product: null,
      category: { percentage: 15, isEnabled: false },
      global: null,
    });
    expect(resolved).toBeNull();
  });

  it("returns null when every tier is entirely unset", () => {
    expect(resolveEffectiveMarkupPercent({})).toBeNull();
  });
});

describe("resolveAndCalculateMarkup", () => {
  it("resolves the effective percentage and computes markup in one call", () => {
    const result = resolveAndCalculateMarkup(1000, {
      product: { percentage: 10, isEnabled: true },
      category: null,
      global: { percentage: 5, isEnabled: true },
    });
    expect(result).not.toBeNull();
    expect(result!.buyerUnitPrice).toBe(1100);
  });

  it("returns null when no markup configuration is enabled anywhere (missing config)", () => {
    const result = resolveAndCalculateMarkup(1000, { product: null, category: null, global: null });
    expect(result).toBeNull();
  });
});

describe("isValidMarkupPercent / isValidSupplierPrice", () => {
  it("rejects negative numbers", () => {
    expect(isValidMarkupPercent(-1)).toBe(false);
    expect(isValidSupplierPrice(-1)).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidMarkupPercent(NaN)).toBe(false);
    expect(isValidMarkupPercent(Infinity)).toBe(false);
    expect(isValidSupplierPrice(NaN)).toBe(false);
    expect(isValidSupplierPrice(Infinity)).toBe(false);
  });

  it("accepts zero and positive finite numbers, including values above 100", () => {
    expect(isValidMarkupPercent(0)).toBe(true);
    expect(isValidMarkupPercent(100)).toBe(true);
    expect(isValidMarkupPercent(500)).toBe(true);
    expect(isValidSupplierPrice(0)).toBe(true);
  });
});

describe("resolveMarkupForProduct (database-backed precedence)", () => {
  function fakeTx(rows: Array<{ scope: string; scopeId: string | null; percentage: number; isEnabled: boolean }>) {
    return {
      markupSetting: {
        findMany: async () => rows,
      },
    };
  }

  it("resolves the product-level override when present", async () => {
    const tx = fakeTx([
      { scope: "PRODUCT", scopeId: "prod-1", percentage: 8, isEnabled: true },
      { scope: "CATEGORY", scopeId: "cat-1", percentage: 15, isEnabled: true },
      { scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true },
    ]);
    const result = await resolveMarkupForProduct(tx, {
      productId: "prod-1",
      categoryId: "cat-1",
      supplierUnitPrice: 1000,
    });
    expect(result?.markupPercent).toBe(8);
    expect(result?.buyerUnitPrice).toBe(1080);
  });

  it("falls back to global when no product/category row exists", async () => {
    const tx = fakeTx([{ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true }]);
    const result = await resolveMarkupForProduct(tx, {
      productId: "prod-missing",
      categoryId: "cat-missing",
      supplierUnitPrice: 1000,
    });
    expect(result?.markupPercent).toBe(10);
  });

  it("returns null when no rows exist at all (missing/invalid configuration)", async () => {
    const tx = fakeTx([]);
    const result = await resolveMarkupForProduct(tx, {
      productId: "prod-1",
      categoryId: "cat-1",
      supplierUnitPrice: 1000,
    });
    expect(result).toBeNull();
  });
});
