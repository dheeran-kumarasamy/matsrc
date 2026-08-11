import { describe, expect, it, vi, beforeEach } from "vitest";
import { PricingNormalizationService } from "./pricing-normalization.service";

/**
 * Follows the makeFakePrisma()/buildService() pattern established in
 * pricing-admin-ops.service.spec.ts. Exercises the actual current behavior
 * of PricingNormalizationService.parsePriceText() and the
 * alias/unit-conversion resolution pipeline (per the inventory's note that
 * these tests must assert real behavior, not assumed RANGE/ON_REQUEST
 * support that doesn't exist yet).
 */
function makeFakePrisma(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {
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
    // Phase 6F: resolveGeographyFields() looks up a DISTRICT context's
    // stateId here. Defaults to resolving DISTRICT_ID -> a fake TN state so
    // pre-existing (pre-Phase-6F) tests that pass a bare districtId string
    // keep working unchanged.
    pricingDistrict: {
      findUnique: vi.fn(async () => ({ stateId: "state-tn" })),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };
  return { ...base, ...overrides } as any;
}

function buildService(prisma: any) {
  return new PricingNormalizationService(prisma);
}

const DISTRICT_ID = "district-1";

describe("PricingNormalizationService.normalizeBatch — missing fields", () => {
  it("marks a raw row REJECTED when rawSkuLabel is missing", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [{ id: "r1", sourceId: "s1", rawSkuLabel: null, rawPriceText: "100", rawUnitText: "kg", rawAsOfText: null }]),
        update: vi.fn(async () => ({})),
      },
    });
    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    expect(result).toEqual({ processed: 1, parsed: 0, unmapped: 0, quarantined: 0, rejected: 1 });
    expect(prisma.pricingRawObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parseStatus: "REJECTED" }) })
    );
  });

  it("marks a raw row REJECTED when rawPriceText is missing", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [{ id: "r1", sourceId: "s1", rawSkuLabel: "TMT 12mm", rawPriceText: null, rawUnitText: "kg", rawAsOfText: null }]),
        update: vi.fn(async () => ({})),
      },
    });
    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    expect(result.rejected).toBe(1);
  });
});

describe("PricingNormalizationService.normalizeBatch — alias resolution", () => {
  it("creates a new alias with canonicalSkuId=null and marks UNMAPPED when this raw label is seen for the first time", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "Unknown Steel Grade", rawPriceText: "50000", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);

    expect(prisma.pricingSkuAlias.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ canonicalSkuId: null, rawLabel: "Unknown Steel Grade", occurrenceCount: 1 }),
      })
    );
    expect(result.unmapped).toBe(1);
  });

  it("increments occurrenceCount when the alias already exists but is still unmapped", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "Unknown Steel Grade", rawPriceText: "50000", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 4, canonicalSkuId: null })),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);

    expect(prisma.pricingSkuAlias.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "alias-1" }, data: { occurrenceCount: 5 } })
    );
    expect(prisma.pricingSkuAlias.create).not.toHaveBeenCalled();
    expect(result.unmapped).toBe(1);
  });

  it("marks UNMAPPED (not a crash) when the alias's canonicalSkuId points at a SKU that no longer exists", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT 12mm", rawPriceText: "58500", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "deleted-sku" })),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      pricingCanonicalSku: { findUnique: vi.fn(async () => null) },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    expect(result.unmapped).toBe(1);
  });
});

describe("PricingNormalizationService.normalizeBatch — unit conversion / quarantine", () => {
  const resolvedAliasPrisma = (conversion: any) =>
    makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT 12mm", rawPriceText: "58500", rawUnitText: "MT", rawAsOfText: "2026-01-01" },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "sku-1" })),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      pricingCanonicalSku: {
        findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })),
      },
      pricingUnitConversion: { findUnique: vi.fn(async () => conversion) },
    });

  it("quarantines when no PricingUnitConversion is found for the unit (never guesses a factor)", async () => {
    const prisma = resolvedAliasPrisma(null);
    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    expect(result.quarantined).toBe(1);
  });

  it("quarantines when the found conversion is flagged isAmbiguous", async () => {
    const prisma = resolvedAliasPrisma({ factor: 1000, toBaseUnit: "KG", isAmbiguous: true });
    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    expect(result.quarantined).toBe(1);
  });

  it("parses successfully and computes pricePerBaseUnit correctly when a valid, unambiguous conversion exists", async () => {
    const prisma = resolvedAliasPrisma({ factor: 1000, toBaseUnit: "KG", isAmbiguous: false });
    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);

    expect(result.parsed).toBe(1);
    expect(prisma.pricingObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pricePerBaseUnit: 58.5, // 58500 / 1000
          baseUnit: "KG",
        }),
      })
    );
  });
});

describe("PricingNormalizationService price text parsing (via normalizeBatch REJECTED outcomes)", () => {
  it("rejects when rawPriceText has no parseable numeric value", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT 12mm", rawPriceText: "Get Price Quote", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "sku-1" })),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      pricingCanonicalSku: { findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })) },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    // Documents current gap: "Get Price Quote" (ON_REQUEST) has no numeric
    // match, so it is REJECTED rather than specially detected as ON_REQUEST.
    expect(result.rejected).toBe(1);
  });

  it("documents current behavior: a RANGE price string only extracts the first number, it is not detected/rejected as a range", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT 12mm", rawPriceText: "5,200 - 6,400", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "sku-1" })),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      pricingCanonicalSku: { findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })) },
      pricingUnitConversion: { findUnique: vi.fn(async () => ({ factor: 1000, toBaseUnit: "KG", isAmbiguous: false })) },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    // "5,200-6,400" -> cleaned "5200-6400" -> regex matches "5200" (first
    // numeric run) rather than recognizing this as a range. Flagged as
    // technical debt in the implementation-inventory, asserted here as the
    // actual current behavior.
    expect(result.parsed).toBe(1);
    expect(prisma.pricingObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quotedPrice: 5200 }) })
    );
  });

  it("strips ₹ symbol and commas correctly for a well-formed price string", async () => {
    const prisma = makeFakePrisma({
      pricingRawObservation: {
        findMany: vi.fn(async () => [
          { id: "r1", sourceId: "s1", rawSkuLabel: "TMT 12mm", rawPriceText: "₹58,500", rawUnitText: "MT", rawAsOfText: null },
        ]),
        update: vi.fn(async () => ({})),
      },
      pricingSkuAlias: {
        findUnique: vi.fn(async () => ({ id: "alias-1", occurrenceCount: 1, canonicalSkuId: "sku-1" })),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      pricingCanonicalSku: { findUnique: vi.fn(async () => ({ id: "sku-1", materialCategoryId: "cat-1" })) },
      pricingUnitConversion: { findUnique: vi.fn(async () => ({ factor: 1000, toBaseUnit: "KG", isAmbiguous: false })) },
    });

    const service = buildService(prisma);
    const result = await service.normalizeBatch(DISTRICT_ID);
    expect(result.parsed).toBe(1);
    expect(prisma.pricingObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quotedPrice: 58500 }) })
    );
  });
});
