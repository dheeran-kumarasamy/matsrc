import { describe, expect, it } from "vitest";
import {
  isValidTaxPercent,
  resolveGstRate,
  resolveGstRateForProduct,
  type GstRateResolution,
} from "./gst-rate-resolution";

function expectResolved(result: GstRateResolution): asserts result is { resolved: true; percentage: number; scope: "PRODUCT" | "CATEGORY" | "GLOBAL" } {
  expect(result.resolved).toBe(true);
}

describe("resolveGstRate — precedence", () => {
  it("resolves the PRODUCT override when present, overriding category and global", () => {
    const result = resolveGstRate({
      product: { percentage: 5, isEnabled: true },
      category: { percentage: 12, isEnabled: true },
      global: { percentage: 18, isEnabled: true },
    });
    expectResolved(result);
    expect(result.percentage).toBe(5);
    expect(result.scope).toBe("PRODUCT");
  });

  it("resolves the CATEGORY override when no product override exists", () => {
    const result = resolveGstRate({
      product: null,
      category: { percentage: 12, isEnabled: true },
      global: { percentage: 18, isEnabled: true },
    });
    expectResolved(result);
    expect(result.percentage).toBe(12);
    expect(result.scope).toBe("CATEGORY");
  });

  it("falls back to GLOBAL when neither product nor category is set", () => {
    const result = resolveGstRate({ product: null, category: null, global: { percentage: 18, isEnabled: true } });
    expectResolved(result);
    expect(result.percentage).toBe(18);
    expect(result.scope).toBe("GLOBAL");
  });

  it("honours an explicit 0% enabled override at any tier (never treated as unset)", () => {
    const result = resolveGstRate({
      product: { percentage: 0, isEnabled: true },
      category: null,
      global: { percentage: 18, isEnabled: true },
    });
    expectResolved(result);
    expect(result.percentage).toBe(0);
    expect(result.scope).toBe("PRODUCT");
  });
});

describe("resolveGstRate — disabled settings are ignored", () => {
  it("falls through a disabled PRODUCT override to CATEGORY", () => {
    const result = resolveGstRate({
      product: { percentage: 5, isEnabled: false },
      category: { percentage: 12, isEnabled: true },
      global: { percentage: 18, isEnabled: true },
    });
    expectResolved(result);
    expect(result.percentage).toBe(12);
    expect(result.scope).toBe("CATEGORY");
  });

  it("falls through disabled PRODUCT and CATEGORY to GLOBAL", () => {
    const result = resolveGstRate({
      product: { percentage: 5, isEnabled: false },
      category: { percentage: 12, isEnabled: false },
      global: { percentage: 18, isEnabled: true },
    });
    expectResolved(result);
    expect(result.percentage).toBe(18);
    expect(result.scope).toBe("GLOBAL");
  });
});

describe("resolveGstRate — missing effective rate never becomes a zero-tax result", () => {
  it("returns an unresolved result (never 0) when every tier is entirely unset", () => {
    const result = resolveGstRate({});
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("NO_SETTING_CONFIGURED");
  });

  it("returns an unresolved result when every configured tier is disabled", () => {
    const result = resolveGstRate({
      product: { percentage: 5, isEnabled: false },
      category: { percentage: 12, isEnabled: false },
      global: { percentage: 18, isEnabled: false },
    });
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("ALL_CONFIGURED_SETTINGS_DISABLED_OR_INVALID");
  });

  it("returns an unresolved result when every configured tier has an invalid percentage", () => {
    const result = resolveGstRate({
      product: { percentage: NaN, isEnabled: true },
      category: { percentage: -5, isEnabled: true },
      global: { percentage: Infinity, isEnabled: true },
    });
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("ALL_CONFIGURED_SETTINGS_DISABLED_OR_INVALID");
  });

  it("falls through an invalid PRODUCT percentage to a valid CATEGORY rate", () => {
    const result = resolveGstRate({
      product: { percentage: NaN, isEnabled: true },
      category: { percentage: 12, isEnabled: true },
      global: null,
    });
    expectResolved(result);
    expect(result.percentage).toBe(12);
    expect(result.scope).toBe("CATEGORY");
  });
});

describe("isValidTaxPercent", () => {
  it("rejects negative numbers", () => {
    expect(isValidTaxPercent(-1)).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidTaxPercent(NaN)).toBe(false);
    expect(isValidTaxPercent(Infinity)).toBe(false);
    expect(isValidTaxPercent(-Infinity)).toBe(false);
  });

  it("accepts zero and positive finite numbers", () => {
    expect(isValidTaxPercent(0)).toBe(true);
    expect(isValidTaxPercent(18)).toBe(true);
    expect(isValidTaxPercent(28)).toBe(true);
  });

  it("rejects non-number input", () => {
    expect(isValidTaxPercent("18")).toBe(false);
    expect(isValidTaxPercent(null)).toBe(false);
    expect(isValidTaxPercent(undefined)).toBe(false);
  });
});

describe("resolveGstRateForProduct (database-backed precedence)", () => {
  function fakeTx(rows: Array<{ scope: string; scopeId: string | null; percentage: number; isEnabled: boolean }>) {
    return {
      taxSetting: {
        findMany: async () => rows,
      },
    };
  }

  it("resolves the product-level override when present", async () => {
    const tx = fakeTx([
      { scope: "PRODUCT", scopeId: "prod-1", percentage: 5, isEnabled: true },
      { scope: "CATEGORY", scopeId: "cat-1", percentage: 12, isEnabled: true },
      { scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true },
    ]);
    const result = await resolveGstRateForProduct(tx, { productId: "prod-1", categoryId: "cat-1" });
    expectResolved(result);
    expect(result.percentage).toBe(5);
    expect(result.scope).toBe("PRODUCT");
  });

  it("falls back to global when no product/category row exists", async () => {
    const tx = fakeTx([{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }]);
    const result = await resolveGstRateForProduct(tx, { productId: "prod-missing", categoryId: "cat-missing" });
    expectResolved(result);
    expect(result.percentage).toBe(18);
    expect(result.scope).toBe("GLOBAL");
  });

  it("returns an unresolved result when no rows exist at all (missing configuration)", async () => {
    const tx = fakeTx([]);
    const result = await resolveGstRateForProduct(tx, { productId: "prod-1", categoryId: "cat-1" });
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("NO_SETTING_CONFIGURED");
  });

  it("returns an unresolved result (never 0) when the only configured rows are disabled", async () => {
    const tx = fakeTx([
      { scope: "PRODUCT", scopeId: "prod-1", percentage: 5, isEnabled: false },
      { scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: false },
    ]);
    const result = await resolveGstRateForProduct(tx, { productId: "prod-1", categoryId: "cat-1" });
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("ALL_CONFIGURED_SETTINGS_DISABLED_OR_INVALID");
  });
});
