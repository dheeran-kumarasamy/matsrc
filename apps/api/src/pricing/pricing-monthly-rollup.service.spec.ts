import { describe, expect, it, vi } from "vitest";
import { PricingMonthlyRollupService } from "./pricing-monthly-rollup.service";

/**
 * Follows the makeFakePrisma()/buildService() pattern from
 * pricing-admin-ops.service.spec.ts. Focuses on the gaps called out in
 * docs/pricing/implementation-inventory.md §7: monthly rollup idempotency,
 * MoM/YoY null-safety when a comparison month has no row, and the
 * confidence-floor rule (never rounds a low-confidence month up).
 */
function makeDailyRow(overrides: Record<string, any> = {}) {
  return {
    canonicalSkuId: overrides.canonicalSkuId ?? "sku-1",
    districtId: overrides.districtId ?? "d1",
    priceDate: overrides.priceDate ?? new Date("2026-01-10"),
    medianPerBaseUnit: overrides.medianPerBaseUnit ?? 100,
    confidence: overrides.confidence ?? "HIGH",
  };
}

function makeFakePrisma(opts: { dailyRows?: any[]; prevMonthRow?: any; yearAgoRow?: any } = {}) {
  return {
    pricingDistrictPriceDaily: {
      findMany: vi.fn(async () => opts.dailyRows ?? []),
    },
    pricingTrendMonthly: {
      findUnique: vi.fn(async ({ where }: any) => {
        const monthStart: Date = where.canonicalSkuId_districtId_monthStart.monthStart;
        const prevMonthStart = opts.prevMonthRow?.monthStart;
        const yearAgoStart = opts.yearAgoRow?.monthStart;
        if (prevMonthStart && monthStart.getTime() === new Date(prevMonthStart).getTime()) {
          return opts.prevMonthRow ?? null;
        }
        if (yearAgoStart && monthStart.getTime() === new Date(yearAgoStart).getTime()) {
          return opts.yearAgoRow ?? null;
        }
        return null;
      }),
      upsert: vi.fn(async () => ({})),
    },
  } as any;
}

function buildService(prisma: any) {
  return new PricingMonthlyRollupService(prisma);
}

describe("PricingMonthlyRollupService.rollupForMonth", () => {
  it("computes median/min/max from the month's daily rows and is idempotent (upsert keyed on [canonicalSkuId, districtId, monthStart])", async () => {
    const dailyRows = [
      makeDailyRow({ medianPerBaseUnit: 100 }),
      makeDailyRow({ medianPerBaseUnit: 110 }),
      makeDailyRow({ medianPerBaseUnit: 90 }),
    ];
    const prisma = makeFakePrisma({ dailyRows });
    const service = buildService(prisma);
    const result = await service.rollupForMonth(new Date("2026-01-01"));

    expect(result.rows).toBe(1);
    expect(prisma.pricingTrendMonthly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          canonicalSkuId_districtId_monthStart: expect.objectContaining({
            canonicalSkuId: "sku-1",
            districtId: "d1",
          }),
        },
        create: expect.objectContaining({ medianPerBaseUnit: 100, minPerBaseUnit: 90, maxPerBaseUnit: 110, dayCount: 3 }),
      })
    );
  });

  it("leaves momChangePct/yoyChangePct null when there is no prior-month or year-ago row (never fabricates a comparison)", async () => {
    const dailyRows = [makeDailyRow({ medianPerBaseUnit: 100 })];
    const prisma = makeFakePrisma({ dailyRows });
    const service = buildService(prisma);
    await service.rollupForMonth(new Date("2026-01-01"));

    expect(prisma.pricingTrendMonthly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ momChangePct: null, yoyChangePct: null }),
      })
    );
  });

  it("computes momChangePct/yoyChangePct when the comparison rows exist", async () => {
    const dailyRows = [makeDailyRow({ medianPerBaseUnit: 110 })];
    const prisma = makeFakePrisma({
      dailyRows,
      prevMonthRow: { monthStart: new Date("2025-12-01"), medianPerBaseUnit: 100 },
      yearAgoRow: { monthStart: new Date("2025-01-01"), medianPerBaseUnit: 55 },
    });
    const service = buildService(prisma);
    await service.rollupForMonth(new Date("2026-01-01"));

    expect(prisma.pricingTrendMonthly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ momChangePct: 10, yoyChangePct: 100 }),
      })
    );
  });

  it("uses the lowest confidence among the contributing daily rows (never rounds a LOW-confidence month up to HIGH)", async () => {
    const dailyRows = [
      makeDailyRow({ id: "r1", confidence: "HIGH" }),
      makeDailyRow({ id: "r2", confidence: "LOW" }),
      makeDailyRow({ id: "r3", confidence: "MEDIUM" }),
    ];
    const prisma = makeFakePrisma({ dailyRows });
    const service = buildService(prisma);
    await service.rollupForMonth(new Date("2026-01-01"));

    expect(prisma.pricingTrendMonthly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ confidence: "LOW" }) })
    );
  });

  it("produces one row per distinct (canonicalSkuId, districtId) pair", async () => {
    const dailyRows = [
      makeDailyRow({ canonicalSkuId: "sku-1", districtId: "d1" }),
      makeDailyRow({ canonicalSkuId: "sku-1", districtId: "d2" }),
      makeDailyRow({ canonicalSkuId: "sku-2", districtId: "d1" }),
    ];
    const prisma = makeFakePrisma({ dailyRows });
    const service = buildService(prisma);
    const result = await service.rollupForMonth(new Date("2026-01-01"));

    expect(result.rows).toBe(3);
    expect(prisma.pricingTrendMonthly.upsert).toHaveBeenCalledTimes(3);
  });
});
