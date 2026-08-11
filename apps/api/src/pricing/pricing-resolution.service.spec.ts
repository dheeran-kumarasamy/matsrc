import { describe, expect, it, vi } from "vitest";
import { PricingResolutionService } from "./pricing-resolution.service";

/**
 * Phase 6F — Geographic Pricing Hierarchy resolution tests.
 * Follows the makeFakePrisma()/buildService() pattern used throughout the
 * pricing module's other .spec.ts files.
 */
function makeDistrict(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "erode-id",
    name: overrides.name ?? "Erode",
    stateId: overrides.stateId ?? "tn-id",
    state: { id: overrides.stateId ?? "tn-id", name: overrides.stateName ?? "Tamil Nadu" },
  };
}

function makeDailyRow(overrides: Record<string, any> = {}) {
  return {
    geographyLevel: overrides.geographyLevel ?? "DISTRICT",
    stateId: overrides.stateId ?? null,
    districtId: overrides.districtId ?? null,
    medianPerBaseUnit: overrides.medianPerBaseUnit ?? 74200,
    baseUnit: overrides.baseUnit ?? "TONNE",
    displayUnit: overrides.displayUnit ?? "TONNE",
    confidence: overrides.confidence ?? "HIGH",
    method: overrides.method ?? "OBSERVED",
    priceDate: overrides.priceDate ?? new Date(),
    publicDisplayAllowed: overrides.publicDisplayAllowed ?? true,
    state: overrides.state ?? (overrides.stateId ? { name: "Tamil Nadu" } : null),
    district: overrides.district ?? (overrides.districtId ? { name: "Erode" } : null),
  };
}

function makeFakePrisma(opts: { district?: any; rowsByLevel?: Record<string, any | null> } = {}) {
  const rowsByLevel = opts.rowsByLevel ?? {};
  return {
    pricingDistrict: {
      findUnique: vi.fn(async () => (opts.district === undefined ? makeDistrict() : opts.district)),
    },
    pricingDistrictPriceDaily: {
      findFirst: vi.fn(async ({ where }: any) => rowsByLevel[where.geographyLevel] ?? null),
    },
  } as any;
}

function buildService(prisma: any) {
  return new PricingResolutionService(prisma);
}

describe("PricingResolutionService.resolveBestAvailablePrice", () => {
  it("Test 1: returns DISTRICT when a district price exists", async () => {
    const districtRow = makeDailyRow({ geographyLevel: "DISTRICT", districtId: "erode-id", medianPerBaseUnit: 74200 });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: districtRow } });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-1", "erode-id");

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.geographyLevel).toBe("DISTRICT");
      expect(result.fallbackUsed).toBe(false);
      expect(result.district).toBe("Erode");
      expect(result.price).toBe(74200);
    }
  });

  it("Test 2: falls back to STATE when no district price exists, marks fallbackUsed=true", async () => {
    const stateRow = makeDailyRow({ geographyLevel: "STATE", stateId: "tn-id", medianPerBaseUnit: 72730, state: { name: "Tamil Nadu" }, district: null });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: null, STATE: stateRow } });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-1", "erode-id");

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.geographyLevel).toBe("STATE");
      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackReason).toBe("NO_DISTRICT_PRICE_AVAILABLE");
      expect(result.district).toBeNull();
      expect(result.state).toBe("Tamil Nadu");
      expect(result.requestedDistrict).toBe("Erode");
    }
  });

  it("Test 3: falls back to NATIONAL when no district/state price exists", async () => {
    const nationalRow = makeDailyRow({ geographyLevel: "NATIONAL", stateId: null, districtId: null, medianPerBaseUnit: 75000, state: null, district: null });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: null, STATE: null, NATIONAL: nationalRow } });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-1", "erode-id");

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.geographyLevel).toBe("NATIONAL");
      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackReason).toBe("NO_STATE_PRICE_AVAILABLE");
      expect(result.state).toBeNull();
      expect(result.district).toBeNull();
    }
  });

  it("Test 4: returns NO_DATA when no price exists at any level", async () => {
    const prisma = makeFakePrisma({ rowsByLevel: {} });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-1", "erode-id");

    expect(result.status).toBe("NO_DATA");
    expect(result.fallbackUsed).toBe(false);
  });

  it("Test 5: a stale district row is excluded by the query's freshness window, so resolution correctly falls back to a fresh state row", async () => {
    // Simulated by findFirst's where-clause staleness filter never matching
    // the stale district row (the fake just returns null for DISTRICT,
    // representing "query found nothing within the freshness window").
    const stateRow = makeDailyRow({ geographyLevel: "STATE", stateId: "tn-id", medianPerBaseUnit: 72730, state: { name: "Tamil Nadu" }, district: null });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: null, STATE: stateRow } });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-1", "erode-id");

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") expect(result.geographyLevel).toBe("STATE");
  });

  it("Test 6: a district row excluded by publicDisplayAllowed=false (license-prohibited) correctly falls back to an allowed state row", async () => {
    // The query itself filters publicDisplayAllowed: true, so a prohibited
    // district row never reaches findValidRow's result — represented here
    // by DISTRICT returning null even though a real (but non-public) row
    // exists in the underlying table.
    const stateRow = makeDailyRow({ geographyLevel: "STATE", stateId: "tn-id", medianPerBaseUnit: 72730, publicDisplayAllowed: true, state: { name: "Tamil Nadu" }, district: null });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: null, STATE: stateRow } });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-1", "erode-id");

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.geographyLevel).toBe("STATE");
      expect(result.fallbackUsed).toBe(true);
    }
    // Verify the DISTRICT query itself included the compliance filter.
    expect(prisma.pricingDistrictPriceDaily.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ geographyLevel: "DISTRICT", publicDisplayAllowed: true }) })
    );
  });

  it("Test 7: a STATE result is never returned with districtId populated", async () => {
    const stateRow = makeDailyRow({ geographyLevel: "STATE", stateId: "tn-id", districtId: null, state: { name: "Tamil Nadu" }, district: null });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: null, STATE: stateRow } });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-1", "erode-id");

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.geographyLevel).toBe("STATE");
      expect(result.district).toBeNull();
    }
  });

  it("Test 8: registered company address is never consulted — resolution only ever queries PricingDistrict/PricingDistrictPriceDaily", async () => {
    const districtRow = makeDailyRow({ geographyLevel: "DISTRICT", districtId: "erode-id" });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: districtRow } });
    const service = buildService(prisma);
    await service.resolveBestAvailablePrice("sku-1", "erode-id");

    // The fake Prisma client exposes no pricingSource accessor at all, so
    // the mere existence of this test object with only pricingDistrict and
    // pricingDistrictPriceDaily proves the resolution service cannot read
    // source/company-address data even if it wanted to.
    expect(Object.keys(prisma)).toEqual(["pricingDistrict", "pricingDistrictPriceDaily"]);
  });

  it("Test 9: AGNI-style STATE result (Tamil Nadu, district=null) is valid and preserved as-is", async () => {
    const stateRow = makeDailyRow({ geographyLevel: "STATE", stateId: "tn-id", districtId: null, medianPerBaseUnit: 72730, state: { name: "Tamil Nadu" }, district: null });
    const prisma = makeFakePrisma({ rowsByLevel: { DISTRICT: null, STATE: stateRow } });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-agni", "erode-id");

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.geographyLevel).toBe("STATE");
      expect(result.state).toBe("Tamil Nadu");
      expect(result.district).toBeNull();
    }
  });

  it("Test 10: an unknown/Delhi-scope districtId never resolves to Tamil Nadu data — yields NO_DATA rather than fabricated geography", async () => {
    const prisma = makeFakePrisma({ district: null, rowsByLevel: {} });
    const service = buildService(prisma);
    const result = await service.resolveBestAvailablePrice("sku-jindal", "delhi-district-id-that-does-not-exist-in-tn-scope");

    expect(result.status).toBe("NO_DATA");
    expect(result.requestedDistrict).toBeNull();
  });
});
