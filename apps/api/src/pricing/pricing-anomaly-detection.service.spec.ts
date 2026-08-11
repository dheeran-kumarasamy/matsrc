import { describe, expect, it, vi } from "vitest";
import { PricingAnomalyDetectionService } from "./pricing-anomaly-detection.service";

/**
 * Follows the makeFakePrisma()/buildService() pattern from
 * pricing-admin-ops.service.spec.ts. Verifies the three anomaly checks never
 * hard-delete an observation — only soft-exclude (isExcluded=true +
 * exclusionReason) paired with a PricingAnomaly audit row.
 */
function makeObservation(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "obs-1",
    canonicalSkuId: overrides.canonicalSkuId ?? "sku-1",
    // Phase 6G: geographyLevel/stateId default to DISTRICT/state-tn so
    // existing fixtures keep working unchanged; districtId is null for a
    // STATE/NATIONAL override, matching the real nullable-districtId shape.
    geographyLevel: overrides.geographyLevel ?? "DISTRICT",
    stateId: "stateId" in overrides ? overrides.stateId : "state-tn",
    districtId:
      overrides.geographyLevel === "STATE" || overrides.geographyLevel === "NATIONAL"
        ? null
        : overrides.districtId ?? "district-1",
    pricePerBaseUnit: overrides.pricePerBaseUnit ?? 100,
    isExcluded: overrides.isExcluded ?? false,
    asOfDate: overrides.asOfDate ?? null,
    fetchedAt: overrides.fetchedAt ?? new Date("2026-01-10T00:00:00.000Z"),
    canonicalSku: {
      materialCategory: {
        floorPerBaseUnit: overrides.floorPerBaseUnit ?? null,
        ceilingPerBaseUnit: overrides.ceilingPerBaseUnit ?? null,
      },
    },
    source: {
      freshnessSlaHours: overrides.freshnessSlaHours ?? null,
    },
  };
}

function makeFakePrisma(observations: any[]) {
  return {
    pricingObservation: {
      findMany: vi.fn(async () => observations),
      update: vi.fn(async () => ({})),
    },
    pricingAnomaly: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  } as any;
}

function buildService(prisma: any) {
  return new PricingAnomalyDetectionService(prisma);
}

describe("PricingAnomalyDetectionService.detectForDate — OUTLIER_MAD", () => {
  it("skips the MAD check for groups with fewer than 4 observations", async () => {
    const observations = [
      makeObservation({ id: "o1", pricePerBaseUnit: 100 }),
      makeObservation({ id: "o2", pricePerBaseUnit: 100000 }), // would be an outlier if checked
      makeObservation({ id: "o3", pricePerBaseUnit: 105 }),
    ];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));
    expect(result.flagged).toBe(0);
    expect(prisma.pricingAnomaly.create).not.toHaveBeenCalled();
  });

  it("flags a clear outlier via soft-exclusion + PricingAnomaly row when the group has >= 4 observations", async () => {
    const observations = [
      makeObservation({ id: "o1", pricePerBaseUnit: 100 }),
      makeObservation({ id: "o2", pricePerBaseUnit: 102 }),
      makeObservation({ id: "o3", pricePerBaseUnit: 98 }),
      makeObservation({ id: "o4", pricePerBaseUnit: 100000 }), // extreme outlier
    ];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));

    expect(result.flagged).toBeGreaterThanOrEqual(1);
    expect(prisma.pricingObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o4" },
        data: expect.objectContaining({ isExcluded: true, exclusionReason: expect.stringContaining("OUTLIER_MAD") }),
      })
    );
    expect(prisma.pricingAnomaly.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ observationId: "o4", reason: "OUTLIER_MAD" }) })
    );
    // never a hard delete
    expect(prisma.pricingObservation.delete).toBeUndefined();
  });

  it("does not flag anything when every value in the group is identical (scaledMad === 0)", async () => {
    const observations = [
      makeObservation({ id: "o1", pricePerBaseUnit: 50 }),
      makeObservation({ id: "o2", pricePerBaseUnit: 50 }),
      makeObservation({ id: "o3", pricePerBaseUnit: 50 }),
      makeObservation({ id: "o4", pricePerBaseUnit: 50 }),
    ];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));
    expect(result.flagged).toBe(0);
  });
});

describe("PricingAnomalyDetectionService.detectForDate — IMPLAUSIBLE_RANGE", () => {
  it("flags an observation below the material category floor", async () => {
    const observations = [makeObservation({ id: "o1", pricePerBaseUnit: 5, floorPerBaseUnit: 10 })];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));

    expect(result.flagged).toBe(1);
    expect(prisma.pricingAnomaly.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: "IMPLAUSIBLE_RANGE" }) })
    );
  });

  it("flags an observation above the material category ceiling", async () => {
    const observations = [makeObservation({ id: "o1", pricePerBaseUnit: 1000, ceilingPerBaseUnit: 500 })];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));

    expect(result.flagged).toBe(1);
  });

  it("does not flag when floor/ceiling are not configured (null)", async () => {
    const observations = [makeObservation({ id: "o1", pricePerBaseUnit: 999999 })];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));
    expect(result.flagged).toBe(0);
  });
});

describe("PricingAnomalyDetectionService.detectForDate — STALE_AS_OF", () => {
  it("flags an observation whose asOfDate age exceeds the source's freshnessSlaHours", async () => {
    const fetchedAt = new Date("2026-01-10T00:00:00.000Z");
    const asOfDate = new Date("2026-01-01T00:00:00.000Z"); // 9 days old
    const observations = [makeObservation({ id: "o1", fetchedAt, asOfDate, freshnessSlaHours: 48 })];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));

    expect(result.flagged).toBe(1);
    expect(prisma.pricingAnomaly.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: "STALE_AS_OF" }) })
    );
  });

  it("does not flag when either freshnessSlaHours or asOfDate is missing", async () => {
    const observations = [
      makeObservation({ id: "o1", asOfDate: null, freshnessSlaHours: 48 }),
      makeObservation({ id: "o2", asOfDate: new Date("2026-01-01"), freshnessSlaHours: null }),
    ];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));
    expect(result.flagged).toBe(0);
  });

  it("does not flag when the observation is within the SLA window", async () => {
    const fetchedAt = new Date("2026-01-10T00:00:00.000Z");
    const asOfDate = new Date("2026-01-09T12:00:00.000Z"); // 12h old
    const observations = [makeObservation({ id: "o1", fetchedAt, asOfDate, freshnessSlaHours: 48 })];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));
    expect(result.flagged).toBe(0);
  });
});

describe("PricingAnomalyDetectionService.detectForDate — cross-check interaction", () => {
  it("documents current behavior: an observation flagged by the MAD check in the first pass is NOT excluded from the second pass's range/stale checks (in-memory isExcluded is not re-read), so it can receive two independent PricingAnomaly rows in one run", async () => {
    // o4 fails BOTH the MAD check (pass 1) and the IMPLAUSIBLE_RANGE floor
    // check (pass 2). The service's second loop only checks `obs.isExcluded`
    // on the in-memory object from the initial findMany() result, which is
    // never mutated after flag() runs (only the DB row is updated via the
    // Prisma mock) — so the second pass's `if (obs.isExcluded) continue;`
    // guard does not actually skip o4, and it gets flagged a second time.
    const observations = [
      makeObservation({ id: "o1", pricePerBaseUnit: 100 }),
      makeObservation({ id: "o2", pricePerBaseUnit: 102 }),
      makeObservation({ id: "o3", pricePerBaseUnit: 98 }),
      makeObservation({ id: "o4", pricePerBaseUnit: 100000, floorPerBaseUnit: 200000 }), // fails BOTH MAD and floor checks
    ];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    await service.detectForDate(new Date("2026-01-10"));

    const anomalyCreateCallsForO4 = prisma.pricingAnomaly.create.mock.calls.filter(
      (call: any[]) => call[0].data.observationId === "o4"
    );
    // Real current behavior: two independent anomaly rows are written for
    // the same observation (OUTLIER_MAD from pass 1, IMPLAUSIBLE_RANGE from
    // pass 2).
    expect(anomalyCreateCallsForO4.length).toBe(2);
    const reasons = anomalyCreateCallsForO4.map((call: any[]) => call[0].data.reason);
    expect(reasons).toEqual(expect.arrayContaining(["OUTLIER_MAD", "IMPLAUSIBLE_RANGE"]));
  });
});

describe("PricingAnomalyDetectionService.detectForDate — Phase 6G geographic isolation", () => {
  it("never mixes a STATE series with a NATIONAL series into one MAD group merely because both have districtId=null", async () => {
    // 3 STATE observations (tight cluster) + 3 NATIONAL observations (a
    // different, tight cluster far away). Neither series is individually an
    // outlier within itself, but if merged into one districtId=null MAD
    // group, the NATIONAL cluster would appear as a wild outlier relative
    // to the STATE cluster's median (and vice versa).
    const observations = [
      makeObservation({ id: "s1", geographyLevel: "STATE", stateId: "state-tn", pricePerBaseUnit: 100 }),
      makeObservation({ id: "s2", geographyLevel: "STATE", stateId: "state-tn", pricePerBaseUnit: 102 }),
      makeObservation({ id: "s3", geographyLevel: "STATE", stateId: "state-tn", pricePerBaseUnit: 98 }),
      makeObservation({ id: "n1", geographyLevel: "NATIONAL", stateId: null, pricePerBaseUnit: 100000 }),
      makeObservation({ id: "n2", geographyLevel: "NATIONAL", stateId: null, pricePerBaseUnit: 100200 }),
      makeObservation({ id: "n3", geographyLevel: "NATIONAL", stateId: null, pricePerBaseUnit: 99800 }),
    ];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));

    // Each group has only 3 members (< 4), so MAD is skipped for both — the
    // point of this test is that they were correctly treated as TWO
    // separate 3-member groups (both skipped), not one merged 6-member
    // group (which would trigger MAD and wrongly flag every row as an
    // outlier of the other series).
    expect(result.flagged).toBe(0);
    expect(prisma.pricingAnomaly.create).not.toHaveBeenCalled();
  });

  it("correctly isolates a DISTRICT series from a STATE series in the same state for the MAD check", async () => {
    const observations = [
      makeObservation({ id: "d1", geographyLevel: "DISTRICT", stateId: "state-tn", districtId: "erode-id", pricePerBaseUnit: 74200 }),
      makeObservation({ id: "d2", geographyLevel: "DISTRICT", stateId: "state-tn", districtId: "erode-id", pricePerBaseUnit: 74300 }),
      makeObservation({ id: "d3", geographyLevel: "DISTRICT", stateId: "state-tn", districtId: "erode-id", pricePerBaseUnit: 74100 }),
      makeObservation({ id: "d4", geographyLevel: "DISTRICT", stateId: "state-tn", districtId: "erode-id", pricePerBaseUnit: 74250 }),
      makeObservation({ id: "st1", geographyLevel: "STATE", stateId: "state-tn", pricePerBaseUnit: 500000 }), // would look like an extreme outlier if merged with the district group
    ];
    const prisma = makeFakePrisma(observations);
    const service = buildService(prisma);
    const result = await service.detectForDate(new Date("2026-01-10"));

    // The STATE observation must never be flagged as an outlier of the
    // DISTRICT group (only 1 STATE observation exists, below the <4 MAD
    // threshold on its own, so it must never be pulled into the 4-member
    // DISTRICT group's calculation).
    expect(result.flagged).toBe(0);
    expect(prisma.pricingAnomaly.create).not.toHaveBeenCalled();
  });
});
