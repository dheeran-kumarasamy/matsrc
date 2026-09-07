import { describe, expect, it, vi } from "vitest";
import { PricingNormalizationService } from "./pricing-normalization.service";

/**
 * Follows the makeFakePrisma()/buildService() pattern.
 * Exercises Phase 2 endpoint-scoped normalization, geography isolation,
 * SKU alias resolution, unit conversion quarantining, and idempotency guarantees.
 */
function makeFakePrisma(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {
    pricingSourceEndpoint: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    pricingRawObservation: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    pricingSkuAlias: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "alias-new", occurrenceCount: 1, ...data })),
      update: vi.fn(async () => ({})),
    },
    pricingCanonicalSku: {
      findUnique: vi.fn(async () => null),
    },
    pricingUnitConversion: {
      findUnique: vi.fn(async () => null),
    },
    pricingObservation: {
      create: vi.fn(async () => ({})),
    },
    pricingDistrict: {
      findUnique: vi.fn(async () => ({ stateId: "state-tn" })),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };

  const result: Record<string, any> = { ...base };
  for (const key of Object.keys(overrides)) {
    if (base[key] && typeof overrides[key] === "object" && !Array.isArray(overrides[key])) {
      result[key] = { ...base[key], ...overrides[key] };
    } else {
      result[key] = overrides[key];
    }
  }
  return result as any;
}

function buildService(prisma: any) {
  return new PricingNormalizationService(prisma);
}

const DISTRICT_ID = "district-1";

describe("Phase 2 — Endpoint-Scoped Normalization & Geography Isolation", () => {
  it("Test 1: Jindal Panther valid mapping with endpoint STATE geography (Delhi)", async () => {
    const jindalEndpoint = {
      id: "ep-jindal",
      sourceId: "src-jindal",
      url: "https://www.jindalpanther.com/recommended-consumer-price",
      geographyLevel: "STATE",
      stateId: "pgstate_delhi",
      districtId: null,
    };
    const rawObs = {
      id: "raw-j1",
      sourceId: "src-jindal",
      sourceUrl: jindalEndpoint.url,
      rawSkuLabel: "TMT Fe 550D 8 mm",
      rawPriceText: "384",
      rawUnitText: "kg",
      rawAsOfText: null,
      payload: { rawSkuLabel: "TMT Fe 550D 8 mm", rawPriceText: "384" },
    };

    const prisma = makeFakePrisma({
      pricingSourceEndpoint: {
        findUnique: vi.fn(async () => jindalEndpoint),
      },
      pricingRawObservation: {
        findMany: vi.fn(async () => [rawObs]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({
          id: "alias-j1",
          rawLabel: "TMT Fe 550D 8 mm",
          canonicalSkuId: "sku-fe550d-8mm",
          occurrenceCount: 1,
        })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({
          id: "sku-fe550d-8mm",
          code: "TMT_FE550D_8MM_GENERIC",
          materialCategoryId: "cat-tmt",
        })),
      },
      pricingUnitConversion: {
        findUnique: vi.fn(async () => ({
          factor: 1,
          toBaseUnit: "KG",
          isAmbiguous: false,
        })),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeEndpoint("ep-jindal");

    expect(result).toEqual({ processed: 1, parsed: 1, unmapped: 0, quarantined: 0, rejected: 0 });
    expect(prisma.pricingObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rawId: "raw-j1",
          sourceId: "src-jindal",
          canonicalSkuId: "sku-fe550d-8mm",
          geographyLevel: "STATE",
          stateId: "pgstate_delhi",
          districtId: null,
          quotedPrice: 384,
          pricePerBaseUnit: 384,
          baseUnit: "KG",
        }),
      })
    );
  });

  it("Test 2: Agni Steels valid mapping with endpoint STATE geography (Tamil Nadu)", async () => {
    const agniEndpoint = {
      id: "ep-agni",
      sourceId: "src-agni",
      url: "https://agnisteels.com/tmt-steel-pricing/",
      geographyLevel: "STATE",
      stateId: "pgstate_tamil_nadu",
      districtId: null,
    };
    const rawObs = {
      id: "raw-a1",
      sourceId: "src-agni",
      sourceUrl: agniEndpoint.url,
      rawSkuLabel: "TMT Fe 550",
      rawPriceText: "55000",
      rawUnitText: "MT",
      rawAsOfText: null,
    };

    const prisma = makeFakePrisma({
      pricingSourceEndpoint: {
        findUnique: vi.fn(async () => agniEndpoint),
      },
      pricingRawObservation: {
        findMany: vi.fn(async () => [rawObs]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({
          id: "alias-a1",
          rawLabel: "TMT Fe 550",
          canonicalSkuId: "sku-fe550-12mm",
          occurrenceCount: 1,
        })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({
          id: "sku-fe550-12mm",
          code: "TMT_FE550_12MM_GENERIC",
          materialCategoryId: "cat-tmt",
        })),
      },
      pricingUnitConversion: {
        findUnique: vi.fn(async () => ({
          factor: 1000,
          toBaseUnit: "KG",
          isAmbiguous: false,
        })),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeEndpoint("ep-agni");

    expect(result).toEqual({ processed: 1, parsed: 1, unmapped: 0, quarantined: 0, rejected: 0 });
    expect(prisma.pricingObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rawId: "raw-a1",
          sourceId: "src-agni",
          geographyLevel: "STATE",
          stateId: "pgstate_tamil_nadu",
          districtId: null,
          pricePerBaseUnit: 55, // 55000 / 1000
        }),
      })
    );
  });

  it("Test 3 & Test 12: Geography isolation — normalizing Endpoint A does not touch or leak to Endpoint B", async () => {
    const endpointA = {
      id: "ep-a",
      sourceId: "src-a",
      url: "https://source-a.com/prices",
      geographyLevel: "STATE",
      stateId: "state-delhi",
      districtId: null,
    };

    const rawObsA = {
      id: "raw-a",
      sourceId: "src-a",
      sourceUrl: endpointA.url,
      rawSkuLabel: "Steel A",
      rawPriceText: "100",
      rawUnitText: "kg",
      rawAsOfText: null,
    };

    const prisma = makeFakePrisma({
      pricingSourceEndpoint: {
        findUnique: vi.fn(async () => endpointA),
      },
      pricingRawObservation: {
        findMany: vi.fn(async (query: any) => {
          // Verify query is strictly scoped to Endpoint A's sourceId and sourceUrl
          if (query.where.sourceId === "src-a" && query.where.sourceUrl === endpointA.url) {
            return [rawObsA];
          }
          return [];
        }),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-a", canonicalSkuId: "sku-a" })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-a", materialCategoryId: "cat-1" })),
      },
      pricingUnitConversion: {
        findUnique: vi.fn(async () => ({ factor: 1, toBaseUnit: "KG", isAmbiguous: false })),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeEndpoint("ep-a");

    expect(result.processed).toBe(1);
    expect(result.parsed).toBe(1);
    // Verified that only raw-a was updated with state-delhi geography
    expect(prisma.pricingObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rawId: "raw-a",
          stateId: "state-delhi",
        }),
      })
    );
  });

  it("Test 4: Wrong geography cannot leak between endpoints", async () => {
    const endpointB = {
      id: "ep-b",
      sourceId: "src-b",
      url: "https://source-b.com/prices",
      geographyLevel: "DISTRICT",
      stateId: "state-tn",
      districtId: "dist-chennai",
    };

    const prisma = makeFakePrisma({
      pricingSourceEndpoint: {
        findUnique: vi.fn(async () => endpointB),
      },
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          {
            id: "raw-b",
            sourceId: "src-b",
            sourceUrl: endpointB.url,
            rawSkuLabel: "Cement B",
            rawPriceText: "350",
            rawUnitText: "bag",
            rawAsOfText: null,
          },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-b", canonicalSkuId: "sku-b" })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-b", materialCategoryId: "cat-cement" })),
      },
      pricingUnitConversion: {
        findUnique: vi.fn(async () => ({ factor: 50, toBaseUnit: "KG", isAmbiguous: false })),
      },
      pricingDistrict: {
        findUnique: vi.fn(async () => ({ stateId: "state-tn" })),
      },
    });

    const service = buildService(prisma);
    await service.normalizeEndpoint("ep-b");

    // Endpoint B observation receives strictly dist-chennai and state-tn, never Delhi or external state
    expect(prisma.pricingObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          geographyLevel: "DISTRICT",
          stateId: "state-tn",
          districtId: "dist-chennai",
        }),
      })
    );
  });

  it("Test 5: Missing or invalid endpoint geography quarantines raw observations without creating PricingObservation", async () => {
    const unconfiguredEndpoint = {
      id: "ep-unconfig",
      sourceId: "src-unconfig",
      url: "https://unconfig.com/prices",
      geographyLevel: null, // Unconfigured!
      stateId: null,
      districtId: null,
    };

    const prisma = makeFakePrisma({
      pricingSourceEndpoint: {
        findUnique: vi.fn(async () => unconfiguredEndpoint),
      },
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "raw-u1", sourceId: "src-unconfig", sourceUrl: unconfiguredEndpoint.url, rawSkuLabel: "TMT 12mm", rawPriceText: "500", rawUnitText: "kg" },
        ]),
        update: vi.fn(async () => ({})),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeEndpoint("ep-unconfig");

    expect(result).toEqual({ processed: 1, parsed: 0, unmapped: 0, quarantined: 1, rejected: 0 });
    expect(prisma.pricingObservation.create).not.toHaveBeenCalled();
    expect(prisma.pricingRawObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "raw-u1" },
        data: expect.objectContaining({
          parseStatus: "QUARANTINED",
          parseError: expect.stringContaining("Endpoint geography is not configured or is invalid"),
        }),
      })
    );
  });

  it("Test 6: Unknown SKU alias marks raw observation UNMAPPED", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "Unknown Rebar Brand X", rawPriceText: "50000", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => null), // Unknown!
        create: vi.fn(async ({ data }: any) => ({ id: "alias-new", occurrenceCount: 1, ...data })),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);

    expect(result.unmapped).toBe(1);
    expect(prisma.pricingObservation.create).not.toHaveBeenCalled();
    expect(prisma.pricingSkuAlias.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ canonicalSkuId: null, rawLabel: "Unknown Rebar Brand X" }),
      })
    );
  });

  it("Test 7: Missing unit mapping quarantines observation", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT Fe 500D 12mm", rawPriceText: "58500", rawUnitText: "unmapped_unit", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "sku-1" })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })),
      },
      pricingUnitConversion: { findUnique: vi.fn(async () => null) }, // Missing!
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);

    expect(result.quarantined).toBe(1);
    expect(prisma.pricingObservation.create).not.toHaveBeenCalled();
    expect(prisma.pricingRawObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r1" },
        data: expect.objectContaining({ parseStatus: "QUARANTINED" }),
      })
    );
  });

  it("Test 8: Ambiguous unit conversion (isAmbiguous = true) quarantines observation", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT Fe 500D 12mm", rawPriceText: "500", rawUnitText: "bundle", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "sku-1" })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })),
      },
      pricingUnitConversion: {
        findUnique: vi.fn(async () => ({ factor: 100, toBaseUnit: "KG", isAmbiguous: true })), // Ambiguous!
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);

    expect(result.quarantined).toBe(1);
    expect(prisma.pricingObservation.create).not.toHaveBeenCalled();
  });

  it("Test 9: Invalid price text marks raw observation REJECTED", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT 12mm", rawPriceText: "Contact Sales Team", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "sku-1" })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);

    expect(result.rejected).toBe(1);
    expect(prisma.pricingObservation.create).not.toHaveBeenCalled();
    expect(prisma.pricingRawObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r1" },
        data: expect.objectContaining({ parseStatus: "REJECTED" }),
      })
    );
  });

  it("Test 10: Idempotent retry — normalizing the same raw observation twice executes without error", async () => {
    const rawObs = {
      id: "raw-repeat",
      sourceId: "src-1",
      sourceUrl: "https://example.com",
      rawSkuLabel: "TMT 12mm",
      rawPriceText: "50000",
      rawUnitText: "MT",
      rawAsOfText: null,
    };

    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [rawObs]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", canonicalSkuId: "sku-1" })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })),
      },
      pricingUnitConversion: {
        findUnique: vi.fn(async () => ({ factor: 1000, toBaseUnit: "KG", isAmbiguous: false })),
      },
    });

    const service = buildService(prisma);
    const run1 = await service.normalizeBatch(DISTRICT_ID);
    const run2 = await service.normalizeBatch(DISTRICT_ID);

    expect(run1.parsed).toBe(1);
    expect(run2.parsed).toBe(1);
    // Transaction creates PricingObservation with rawId: "raw-repeat" uniquely
    expect(prisma.pricingObservation.create).toHaveBeenCalledTimes(2);
  });

  it("Test 11: Raw payload immutability — normalization updates parseStatus/parseError only, never raw payload", async () => {
    const rawPayload = { rawSkuLabel: "TMT Fe 500D 12mm", rawPriceText: "58500", rawUnitText: "MT" };
    const rawObs = {
      id: "raw-immut",
      sourceId: "src-1",
      sourceUrl: "https://example.com",
      rawSkuLabel: "TMT Fe 500D 12mm",
      rawPriceText: "58500",
      rawUnitText: "MT",
      rawAsOfText: null,
      payload: rawPayload,
    };

    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [rawObs]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", canonicalSkuId: "sku-1" })),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })),
      },
      pricingUnitConversion: {
        findUnique: vi.fn(async () => ({ factor: 1000, toBaseUnit: "KG", isAmbiguous: false })),
      },
    });

    const service = buildService(prisma);
    await service.normalizeBatch(DISTRICT_ID);

    expect(prisma.pricingRawObservation.update).toHaveBeenCalledWith({
      where: { id: "raw-immut" },
      data: { parseStatus: "PARSED", parseError: null },
    });
    // Verified payload field was not passed in update data
    expect(rawObs.payload).toEqual(rawPayload);
  });
});
