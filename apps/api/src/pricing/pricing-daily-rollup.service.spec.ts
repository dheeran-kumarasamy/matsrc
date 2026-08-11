import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PricingDailyRollupService } from "./pricing-daily-rollup.service";

/**
 * Follows the makeFakePrisma()/buildService() pattern from
 * pricing-admin-ops.service.spec.ts. Focuses on the two gaps called out in
 * docs/pricing/implementation-inventory.md §7: rollup idempotency and
 * derived-pricing null-safety (never fabricating a DERIVED_* row without a
 * verifiable anchor + input).
 */
function makeObservation(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "obs-1",
    canonicalSkuId: overrides.canonicalSkuId ?? "sku-1",
    // Phase 6F: geographyLevel/stateId/districtId replace the old
    // districtId-only shape. Defaults to DISTRICT/state-tn/d1 so existing
    // (pre-Phase-6F) test fixtures keep working unchanged.
    geographyLevel: overrides.geographyLevel ?? "DISTRICT",
    stateId: "stateId" in overrides ? overrides.stateId : "state-tn",
    districtId: overrides.geographyLevel === "STATE" || overrides.geographyLevel === "NATIONAL" ? null : overrides.districtId ?? "d1",
    pricePerBaseUnit: overrides.pricePerBaseUnit ?? 100,
    baseUnit: overrides.baseUnit ?? "KG",
    source: {
      code: overrides.sourceCode ?? "SRC_A",
      publicDisplayAllowed: overrides.publicDisplayAllowed ?? true,
    },
    canonicalSku: {
      materialCategory: { displayUnit: overrides.displayUnit ?? "KG" },
    },
  };
}

function makeDistrict(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "d1",
    stateId: overrides.stateId ?? "state-tn",
    anchorDistrictId: overrides.anchorDistrictId ?? null,
    anchorRoadDistanceKm: overrides.anchorRoadDistanceKm ?? null,
    desCentreCode: overrides.desCentreCode ?? null,
    sorAreaSupplementPct: overrides.sorAreaSupplementPct ?? null,
  };
}

function makeFakePrisma(opts: { observations?: any[]; districts?: any[] } = {}) {
  return {
    pricingObservation: {
      findMany: vi.fn(async () => opts.observations ?? []),
    },
    pricingDistrictPriceDaily: {
      upsert: vi.fn(async () => ({})),
    },
    pricingDistrict: {
      findMany: vi.fn(async () => opts.districts ?? []),
    },
    pricingCostIndex: {
      findFirst: vi.fn(async () => null),
    },
  } as any;
}

function buildService(prisma: any) {
  const config = { isEnabled: () => true, isApifyLiveEnabled: () => false } as any;
  return new PricingDailyRollupService(prisma, config);
}

describe("PricingDailyRollupService.rollupForDate — OBSERVED pass", () => {
  it("computes median/p25/p75/min/max from a district's observations for that SKU/date", async () => {
    const observations = [
      makeObservation({ id: "o1", pricePerBaseUnit: 100 }),
      makeObservation({ id: "o2", pricePerBaseUnit: 102 }),
      makeObservation({ id: "o3", pricePerBaseUnit: 98 }),
    ];
    const prisma = makeFakePrisma({ observations });
    const service = buildService(prisma);
    const result = await service.rollupForDate(new Date("2026-01-10"));

    expect(result.observedRows).toBe(1);
    expect(prisma.pricingDistrictPriceDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ method: "OBSERVED", medianPerBaseUnit: 100, observationCount: 3 }),
      })
    );
  });

  it("sets publicDisplayAllowed=false when even one contributing source disallows public display", async () => {
    const observations = [
      makeObservation({ id: "o1", sourceCode: "SRC_A", publicDisplayAllowed: true }),
      makeObservation({ id: "o2", sourceCode: "SRC_B", publicDisplayAllowed: false }),
    ];
    const prisma = makeFakePrisma({ observations });
    const service = buildService(prisma);
    await service.rollupForDate(new Date("2026-01-10"));

    expect(prisma.pricingDistrictPriceDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ publicDisplayAllowed: false }) })
    );
  });

  it("is idempotent: the update branch always resets anchorDistrictId/derivationJson to null, so re-running an OBSERVED rollup never leaves stale derived-only fields from a prior run", async () => {
    const observations = [makeObservation({ id: "o1" })];
    const prisma = makeFakePrisma({ observations });
    const service = buildService(prisma);
    await service.rollupForDate(new Date("2026-01-10"));

    expect(prisma.pricingDistrictPriceDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { canonicalSkuId_geoKey_priceDate: expect.objectContaining({ canonicalSkuId: "sku-1", geoKey: "d1" }) },
        update: expect.objectContaining({ anchorDistrictId: null }),
      })
    );
  });
});

describe("PricingDailyRollupService.rollupForDate — DERIVED_* pass", () => {
  const ORIGINAL_ENV = process.env.PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT;
  beforeEach(() => {
    process.env.PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT = "0.1";
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT;
    else process.env.PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT = ORIGINAL_ENV;
  });

  it("derives a DERIVED_FREIGHT row for a district anchored to a district with an OBSERVED row, and always marks it publicDisplayAllowed=false", async () => {
    const observations = [makeObservation({ id: "o1", districtId: "d1", pricePerBaseUnit: 100 })];
    const districts = [makeDistrict({ id: "d1" }), makeDistrict({ id: "d2", anchorDistrictId: "d1", anchorRoadDistanceKm: 50 })];
    const prisma = makeFakePrisma({ observations, districts });
    const service = buildService(prisma);
    const result = await service.rollupForDate(new Date("2026-01-10"));

    expect(result.derivedRows).toBe(1);
    expect(prisma.pricingDistrictPriceDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          districtId: "d2",
          method: "DERIVED_FREIGHT",
          publicDisplayAllowed: false,
          confidence: "LOW",
        }),
      })
    );
  });

  it("never fabricates a derived row when the anchor district itself has no OBSERVED row for that SKU/date", async () => {
    // d2 anchors to d3, but d3 has no observation at all this run.
    const observations = [makeObservation({ id: "o1", districtId: "d1" })];
    const districts = [
      makeDistrict({ id: "d1" }),
      makeDistrict({ id: "d3" }),
      makeDistrict({ id: "d2", anchorDistrictId: "d3", anchorRoadDistanceKm: 50 }),
    ];
    const prisma = makeFakePrisma({ observations, districts });
    const service = buildService(prisma);
    const result = await service.rollupForDate(new Date("2026-01-10"));

    expect(result.derivedRows).toBe(0);
  });

  it("never fabricates a derived row for a district with no anchorDistrictId configured", async () => {
    const observations = [makeObservation({ id: "o1", districtId: "d1" })];
    const districts = [makeDistrict({ id: "d1" }), makeDistrict({ id: "d2", anchorDistrictId: null })];
    const prisma = makeFakePrisma({ observations, districts });
    const service = buildService(prisma);
    const result = await service.rollupForDate(new Date("2026-01-10"));

    expect(result.derivedRows).toBe(0);
  });
});

describe("PricingDailyRollupService.rollupForDate — Phase 6F geography isolation", () => {
  it("produces two SEPARATE rows (never merged) for a DISTRICT observation and a STATE observation of the same canonicalSku on the same day", async () => {
    const observations = [
      makeObservation({ id: "o1", geographyLevel: "DISTRICT", stateId: "state-tn", districtId: "d1", pricePerBaseUnit: 74200 }),
      makeObservation({ id: "o2", geographyLevel: "STATE", stateId: "state-tn", districtId: null, pricePerBaseUnit: 72730 }),
    ];
    const prisma = makeFakePrisma({ observations });
    const service = buildService(prisma);
    const result = await service.rollupForDate(new Date("2026-01-10"));

    expect(result.observedRows).toBe(2);
    expect(prisma.pricingDistrictPriceDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { canonicalSkuId_geoKey_priceDate: expect.objectContaining({ geoKey: "d1" }) },
        create: expect.objectContaining({ geographyLevel: "DISTRICT", stateId: "state-tn", districtId: "d1", medianPerBaseUnit: 74200 }),
      })
    );
    expect(prisma.pricingDistrictPriceDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { canonicalSkuId_geoKey_priceDate: expect.objectContaining({ geoKey: "state-tn" }) },
        create: expect.objectContaining({ geographyLevel: "STATE", stateId: "state-tn", districtId: null, medianPerBaseUnit: 72730 }),
      })
    );
  });

  it("produces an OBSERVED NATIONAL row from NATIONAL-geography observations, with geoKey='NATIONAL' and stateId/districtId both null", async () => {
    const observations = [makeObservation({ id: "o1", geographyLevel: "NATIONAL", stateId: null, districtId: null, pricePerBaseUnit: 75000 })];
    const prisma = makeFakePrisma({ observations });
    const service = buildService(prisma);
    const result = await service.rollupForDate(new Date("2026-01-10"));

    expect(result.observedRows).toBe(1);
    expect(prisma.pricingDistrictPriceDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { canonicalSkuId_geoKey_priceDate: expect.objectContaining({ geoKey: "NATIONAL" }) },
        create: expect.objectContaining({ geographyLevel: "NATIONAL", stateId: null, districtId: null }),
      })
    );
  });
});
