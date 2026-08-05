// Phase 6B — focused security test (spec §18) for the Market Intelligence
// data layer. Verifies, by construction:
//   1. Every serving-layer query (`PricingDistrictPriceDaily`) is filtered on
//      `publicDisplayAllowed: true` — the same gate the public builder API
//      uses — so INTERNAL_ONLY-licensed rows can never surface here.
//   2. The raw/per-source tables (`PricingObservation`, `PricingRawObservation`,
//      `PricingSource`) are never queried at all from this file.
//   3. None of the row shapes returned to the UI ever contain a competitor
//      identity, competitor price, or other-supplier field — only aggregate
//      market statistics (median/p25/p75/observationCount/confidence/etc).
//
// This test mocks `@matsrc/db` and `./supplier-data` so it never touches a
// real database — it only asserts on how this module calls Prisma and what
// shape it returns.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock(...) factories are hoisted above all top-level statements, so
// every fixture/tracker referenced inside them must be created via
// vi.hoisted() to avoid "Cannot access before initialization" errors.
const {
  findManyCalls,
  findFirstCalls,
  trackedFindMany,
  trackedFindFirst,
  districtRow,
  dailyPriceRow,
  trendRow,
  canonicalSkuRow,
  productRow,
} = vi.hoisted(() => {
  const findManyCalls: { model: string; args: any }[] = [];
  const findFirstCalls: { model: string; args: any }[] = [];

  function trackedFindMany(model: string, result: any[]) {
    return (args: any) => {
      findManyCalls.push({ model, args });
      return Promise.resolve(result);
    };
  }

  function trackedFindFirst(model: string, result: any) {
    return (args: any) => {
      findFirstCalls.push({ model, args });
      return Promise.resolve(result);
    };
  }

  const districtRow = { id: "district-1", code: "TN-CBE", name: "Coimbatore" };

  const dailyPriceRow = {
    id: "daily-1",
    canonicalSkuId: "sku-1",
    districtId: "district-1",
    priceDate: new Date("2025-01-01"),
    baseUnit: "KG",
    medianPerBaseUnit: 100,
    p25PerBaseUnit: 90,
    p75PerBaseUnit: 110,
    minPerBaseUnit: 80,
    maxPerBaseUnit: 120,
    observationCount: 12,
    sourceCount: 3,
    method: "OBSERVED",
    confidence: "HIGH",
    publicDisplayAllowed: true,
    matsrcMedianPerBaseUnit: 95,
    matsrcQuoteCount: 2,
    district: { code: "TN-CBE", name: "Coimbatore" },
  };

  const trendRow = {
    id: "trend-1",
    canonicalSkuId: "sku-1",
    districtId: "district-1",
    monthStart: new Date("2024-06-01"),
    medianPerBaseUnit: 98,
    minPerBaseUnit: 88,
    maxPerBaseUnit: 108,
    momChangePct: 1.2,
    yoyChangePct: 3.4,
    dayCount: 28,
    confidence: "HIGH",
  };

  const canonicalSkuRow = {
    id: "sku-1",
    code: "CEMENT_OPC_53",
    materialCategoryId: "cat-1",
    materialCategory: { name: "Cement" },
  };

  const productRow = {
    id: "product-1",
    name: "OPC 53 Cement",
    basePrice: 105,
    unit: "BAG",
    category: { id: "cat-1", name: "Cement" },
  };

  return {
    findManyCalls,
    findFirstCalls,
    trackedFindMany,
    trackedFindFirst,
    districtRow,
    dailyPriceRow,
    trendRow,
    canonicalSkuRow,
    productRow,
  };
});

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      product: {
        findMany: trackedFindMany("product", [productRow]),
        count: vi.fn(() => Promise.resolve(1)),
      },
      pricingCanonicalSku: {
        findMany: trackedFindMany("pricingCanonicalSku", [canonicalSkuRow]),
        findFirst: trackedFindFirst("pricingCanonicalSku.findFirst", canonicalSkuRow),
      },
      pricingDistrictPriceDaily: {
        findMany: trackedFindMany("pricingDistrictPriceDaily", [dailyPriceRow]),
        findFirst: trackedFindFirst("pricingDistrictPriceDaily.findFirst", dailyPriceRow),
      },
      pricingTrendMonthly: {
        findMany: trackedFindMany("pricingTrendMonthly", [trendRow]),
      },
      pricingDistrict: {
        findMany: trackedFindMany("pricingDistrict", [districtRow]),
      },
    },
  };
});

vi.mock("./supplier-data", () => {
  return {
    ensureSupplierContext: vi.fn(() =>
      Promise.resolve({ supplierProfile: { id: "supplier-1" }, user: { id: "user-1" } })
    ),
  };
});

import {
  getListingCompetitiveness,
  getCategoryTrendReport,
  getDistrictOpportunityReport,
  getMarketIntelligenceSummary,
  getRfqMarketGuidance,
} from "./market-intelligence-data";

// Fields that must NEVER appear anywhere in a row returned by this module —
// these would indicate a competitor-identifying or raw/internal-only leak.
const FORBIDDEN_KEY_PATTERNS = [
  /supplierName/i,
  /supplierId/i,
  /matsrcSupplierId/i,
  /competitor/i,
  /rawSkuLabel/i,
  /rawPriceText/i,
  /rawSupplierName/i,
  /sourceUrl/i,
  /sourceId/i,
  /licenseClass/i,
  /INTERNAL_ONLY/i,
  /payload/i,
];

function assertNoForbiddenKeys(value: unknown, path = "root") {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      for (const pattern of FORBIDDEN_KEY_PATTERNS) {
        expect(pattern.test(key), `Forbidden key "${key}" found at ${path}.${key}`).toBe(false);
      }
      assertNoForbiddenKeys(val, `${path}.${key}`);
    }
  }
}

describe("market-intelligence-data security (spec §18)", () => {
  beforeEach(() => {
    findManyCalls.length = 0;
    findFirstCalls.length = 0;
  });

  it("getListingCompetitiveness only reads publicDisplayAllowed:true serving-layer rows and returns no forbidden fields", async () => {
    const rows = await getListingCompetitiveness("supplier@example.com");
    assertNoForbiddenKeys(rows);

    const dailyCalls = findManyCalls.filter((c) => c.model === "pricingDistrictPriceDaily");
    expect(dailyCalls.length).toBeGreaterThan(0);
    for (const call of dailyCalls) {
      expect(call.args.where.publicDisplayAllowed).toBe(true);
    }
  });

  it("getCategoryTrendReport returns no forbidden fields", async () => {
    const rows = await getCategoryTrendReport("supplier@example.com");
    assertNoForbiddenKeys(rows);
  });

  it("getDistrictOpportunityReport only reads publicDisplayAllowed:true rows and returns no forbidden fields", async () => {
    const rows = await getDistrictOpportunityReport("supplier@example.com");
    assertNoForbiddenKeys(rows);

    const dailyCalls = findManyCalls.filter((c) => c.model === "pricingDistrictPriceDaily");
    expect(dailyCalls.length).toBeGreaterThan(0);
    for (const call of dailyCalls) {
      expect(call.args.where.publicDisplayAllowed).toBe(true);
    }
  });

  it("getMarketIntelligenceSummary returns only aggregate KPI numbers/labels, no forbidden fields", async () => {
    const summary = await getMarketIntelligenceSummary("supplier@example.com");
    assertNoForbiddenKeys(summary);
    expect(typeof summary.activeListings).toBe("number");
  });

  it("getRfqMarketGuidance only reads publicDisplayAllowed:true rows and never returns supplier/competitor identity", async () => {
    const guidance = await getRfqMarketGuidance("Cement");
    assertNoForbiddenKeys(guidance);

    const findFirstCall = findFirstCalls.find((c) => c.model === "pricingDistrictPriceDaily.findFirst");
    expect(findFirstCall?.args.where.publicDisplayAllowed).toBe(true);
  });

  it("never queries raw/internal-only tables (pricingObservation, pricingRawObservation, pricingSource)", async () => {
    // These models are intentionally absent from the @matsrc/db mock above —
    // if market-intelligence-data.ts ever imports/calls them, the mock
    // module would throw a "not a function" error during the calls above,
    // which already ran successfully. This test documents that guarantee
    // explicitly for future maintainers.
    await getListingCompetitiveness("supplier@example.com");
    await getCategoryTrendReport("supplier@example.com");
    await getDistrictOpportunityReport("supplier@example.com");
    await getMarketIntelligenceSummary("supplier@example.com");
    await getRfqMarketGuidance("Cement");
    expect(true).toBe(true);
  });
});
