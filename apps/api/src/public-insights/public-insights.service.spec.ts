import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ProductInterestEventType } from "@matsrc/db";
import { PublicInsightsService } from "./public-insights.service";

function buildPrisma(overrides: Partial<any> = {}) {
  return {
    supplierRating: {
      aggregate: vi.fn().mockResolvedValue({
        _count: { _all: 0 },
        _avg: { deliveryRating: null, qualityRating: null },
      }),
    },
    product: {
      findUnique: vi.fn().mockResolvedValue({ id: "listing-1" }),
    },
    productInterestEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe("PublicInsightsService.getSupplierRatingsSummary", () => {
  it("flags insufficientData when totalRatings is below 5", async () => {
    const prisma = buildPrisma({
      supplierRating: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 3 },
          _avg: { deliveryRating: 4.3333, qualityRating: 4.0 },
        }),
      },
    });

    const service = new PublicInsightsService(prisma as any);
    const result = await service.getSupplierRatingsSummary("sup-1");

    expect(result.totalRatings).toBe(3);
    expect(result.insufficientData).toBe(true);
    expect(result.avgDeliveryRating).toBe(4.3);
    expect(result.avgQualityRating).toBe(4.0);
  });

  it("returns insufficientData false and rounds averages when totalRatings >= 5", async () => {
    const prisma = buildPrisma({
      supplierRating: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 12 },
          _avg: { deliveryRating: 4.567, qualityRating: 3.849 },
        }),
      },
    });

    const service = new PublicInsightsService(prisma as any);
    const result = await service.getSupplierRatingsSummary("sup-2");

    expect(result.insufficientData).toBe(false);
    expect(result.avgDeliveryRating).toBe(4.6);
    expect(result.avgQualityRating).toBe(3.8);
  });

  it("caches the summary for subsequent calls within the TTL window", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _count: { _all: 10 },
      _avg: { deliveryRating: 4, qualityRating: 4 },
    });
    const prisma = buildPrisma({ supplierRating: { aggregate } });

    const service = new PublicInsightsService(prisma as any);
    await service.getSupplierRatingsSummary("sup-3");
    await service.getSupplierRatingsSummary("sup-3");

    expect(aggregate).toHaveBeenCalledTimes(1);
  });
});

describe("PublicInsightsService.recordInterestEvent", () => {
  it("throws NotFoundException when the listing does not exist", async () => {
    const prisma = buildPrisma({
      product: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    const service = new PublicInsightsService(prisma as any);

    await expect(
      service.recordInterestEvent("missing-listing", {
        eventType: ProductInterestEventType.VIEW,
        sessionId: "session-1",
      })
    ).rejects.toThrow(NotFoundException);
  });

  it("throws BadRequestException when sessionId is blank after trimming", async () => {
    const prisma = buildPrisma();
    const service = new PublicInsightsService(prisma as any);

    await expect(
      service.recordInterestEvent("listing-1", {
        eventType: ProductInterestEventType.VIEW,
        sessionId: "   ",
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("creates a new event when no recent duplicate exists", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = buildPrisma({
      productInterestEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const service = new PublicInsightsService(prisma as any);
    const result = await service.recordInterestEvent("listing-1", {
      eventType: ProductInterestEventType.VIEW,
      sessionId: "session-1",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ accepted: true, deduplicated: false });
  });

  it("deduplicates repeated events from the same session within the rate-limit window", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = buildPrisma({
      productInterestEvent: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing-event" }),
        create,
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const service = new PublicInsightsService(prisma as any);
    const result = await service.recordInterestEvent("listing-1", {
      eventType: ProductInterestEventType.VIEW,
      sessionId: "session-1",
    });

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ accepted: true, deduplicated: true });
  });
});

describe("PublicInsightsService.getAnchoring", () => {
  it("suppresses lockedPercent when viewer sample is below the minimum threshold", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ sessionId: "s1" }, { sessionId: "s2" }]) // views: below MIN_SAMPLE_SIZE (20)
      .mockResolvedValueOnce([{ sessionId: "s1" }]); // orders

    const prisma = buildPrisma({
      productInterestEvent: { findFirst: vi.fn(), create: vi.fn(), findMany },
    });

    const service = new PublicInsightsService(prisma as any);
    const result = await service.getAnchoring("listing-1");

    expect(result.viewersLast24h).toBe(2);
    expect(result.lockedPercent).toBeNull();
  });

  it("guards against division by zero when there are no viewers at all", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const prisma = buildPrisma({
      productInterestEvent: { findFirst: vi.fn(), create: vi.fn(), findMany },
    });

    const service = new PublicInsightsService(prisma as any);
    const result = await service.getAnchoring("listing-1");

    expect(result.viewersLast24h).toBe(0);
    expect(result.lockedPercent).toBeNull();
  });

  it("computes lockedPercent when the sample size meets the minimum threshold", async () => {
    const viewSessions = Array.from({ length: 25 }, (_, index) => ({ sessionId: `viewer-${index}` }));
    const orderSessions = [
      { sessionId: "viewer-0" },
      { sessionId: "viewer-1" },
      { sessionId: "viewer-2" },
      { sessionId: "viewer-3" },
      { sessionId: "not-a-viewer" }, // should not count; not in view set
    ];

    const findMany = vi.fn().mockResolvedValueOnce(viewSessions).mockResolvedValueOnce(orderSessions);

    const prisma = buildPrisma({
      productInterestEvent: { findFirst: vi.fn(), create: vi.fn(), findMany },
    });

    const service = new PublicInsightsService(prisma as any);
    const result = await service.getAnchoring("listing-1");

    expect(result.viewersLast24h).toBe(25);
    // 4 locked sessions out of 25 viewers = 16%
    expect(result.lockedPercent).toBe(16);
  });
});

describe("PublicInsightsService interest-event lifecycle (integration-style)", () => {
  it("reflects VIEW -> CART_ADD -> ORDER_PLACED events in the anchoring aggregation", async () => {
    // In-memory fake store standing in for ProductInterestEvent rows.
    const store: Array<{ listingId: string; sessionId: string; eventType: ProductInterestEventType; createdAt: Date }> = [];

    const prisma = {
      product: { findUnique: vi.fn().mockResolvedValue({ id: "listing-1" }) },
      supplierRating: { aggregate: vi.fn() },
      productInterestEvent: {
        findFirst: vi.fn(async ({ where }: any) => {
          return (
            store.find(
              (row) =>
                row.listingId === where.listingId &&
                row.eventType === where.eventType &&
                row.sessionId === where.sessionId &&
                row.createdAt >= where.createdAt.gte
            ) ?? null
          );
        }),
        create: vi.fn(async ({ data }: any) => {
          const row = { ...data, createdAt: new Date() };
          store.push(row);
          return row;
        }),
        findMany: vi.fn(async ({ where, distinct }: any) => {
          const matches = store.filter(
            (row) =>
              row.listingId === where.listingId &&
              row.eventType === where.eventType &&
              row.createdAt >= where.createdAt.gte
          );

          if (distinct?.includes("sessionId")) {
            const seen = new Set<string>();
            return matches.filter((row) => {
              if (seen.has(row.sessionId)) return false;
              seen.add(row.sessionId);
              return true;
            });
          }

          return matches;
        }),
      },
    };

    const service = new PublicInsightsService(prisma as any);

    // Simulate 20 unique viewers (meets MIN_SAMPLE_SIZE), 1 of them converts.
    for (let i = 0; i < 20; i++) {
      await service.recordInterestEvent("listing-1", {
        eventType: ProductInterestEventType.VIEW,
        sessionId: `viewer-${i}`,
      });
    }

    await service.recordInterestEvent("listing-1", {
      eventType: ProductInterestEventType.CART_ADD,
      sessionId: "viewer-0",
    });

    await service.recordInterestEvent("listing-1", {
      eventType: ProductInterestEventType.ORDER_PLACED,
      sessionId: "viewer-0",
    });

    const anchoring = await service.getAnchoring("listing-1");

    expect(anchoring.viewersLast24h).toBe(20);
    expect(anchoring.lockedPercent).toBe(5); // 1 of 20 viewers converted = 5%
  });
});

