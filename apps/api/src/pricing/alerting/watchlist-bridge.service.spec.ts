import { describe, expect, it, vi } from "vitest";
import { WatchlistBridgeService } from "./watchlist-bridge.service";
import { ALERT_SUPPRESSION_REASONS } from "./alert-suppression-reason";

function makeFakePrisma(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {
    product: { findUnique: vi.fn(async () => null) },
    pricingCanonicalSku: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    site: { findFirst: vi.fn(async () => null) },
    pricingDistrict: { findFirst: vi.fn(async () => null) },
  };
  return { ...base, ...overrides } as any;
}

function buildService(prisma: any) {
  return new WatchlistBridgeService(prisma);
}

describe("WatchlistBridgeService.resolveCanonicalSku", () => {
  it("suppresses with CANONICAL_SKU_UNMAPPED when the product has no canonicalProductId", async () => {
    const prisma = makeFakePrisma({
      product: { findUnique: vi.fn(async () => ({ canonicalProductId: null, canonicalProduct: null })) },
    });
    const service = buildService(prisma);
    const result = await service.resolveCanonicalSku("product-1");
    expect(result).toEqual({ ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.CANONICAL_SKU_UNMAPPED });
  });

  it("resolves via exact matsrcListingId match when available", async () => {
    const prisma = makeFakePrisma({
      product: {
        findUnique: vi.fn(async () => ({
          canonicalProductId: "canon-1",
          canonicalProduct: { id: "canon-1", category: { name: "Steel" }, brand: { name: "Tata" } },
        })),
      },
      pricingCanonicalSku: {
        findFirst: vi.fn(async () => ({ id: "sku-exact" })),
        findMany: vi.fn(async () => []),
      },
    });
    const service = buildService(prisma);
    const result = await service.resolveCanonicalSku("product-1");
    expect(result).toEqual({ ok: true, canonicalSkuId: "sku-exact" });
  });

  it("falls back to unambiguous category+brand match when no exact match exists", async () => {
    const prisma = makeFakePrisma({
      product: {
        findUnique: vi.fn(async () => ({
          canonicalProductId: "canon-1",
          canonicalProduct: { id: "canon-1", category: { name: "Steel" }, brand: { name: "Tata" } },
        })),
      },
      pricingCanonicalSku: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ id: "sku-fallback" }]),
      },
    });
    const service = buildService(prisma);
    const result = await service.resolveCanonicalSku("product-1");
    expect(result).toEqual({ ok: true, canonicalSkuId: "sku-fallback" });
  });

  it("never guesses among multiple ambiguous fallback candidates — suppresses instead", async () => {
    const prisma = makeFakePrisma({
      product: {
        findUnique: vi.fn(async () => ({
          canonicalProductId: "canon-1",
          canonicalProduct: { id: "canon-1", category: { name: "Steel" }, brand: null },
        })),
      },
      pricingCanonicalSku: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ id: "sku-a" }, { id: "sku-b" }]),
      },
    });
    const service = buildService(prisma);
    const result = await service.resolveCanonicalSku("product-1");
    expect(result).toEqual({ ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.CANONICAL_SKU_UNMAPPED });
  });
});

describe("WatchlistBridgeService.resolveDistrict", () => {
  it("suppresses with DISTRICT_UNRESOLVED when the builder has no active site with a city", async () => {
    const prisma = makeFakePrisma({ site: { findFirst: vi.fn(async () => null) } });
    const service = buildService(prisma);
    const result = await service.resolveDistrict("builder-1");
    expect(result).toEqual({ ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.DISTRICT_UNRESOLVED });
  });

  it("suppresses with DISTRICT_UNRESOLVED when the site's city does not match any known PricingDistrict", async () => {
    const prisma = makeFakePrisma({
      site: { findFirst: vi.fn(async () => ({ city: "Nowhereville" })) },
      pricingDistrict: { findFirst: vi.fn(async () => null) },
    });
    const service = buildService(prisma);
    const result = await service.resolveDistrict("builder-1");
    expect(result).toEqual({ ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.DISTRICT_UNRESOLVED });
  });

  it("resolves the district case-insensitively via the builder's most-recent active site city", async () => {
    const prisma = makeFakePrisma({
      site: { findFirst: vi.fn(async () => ({ city: "chennai" })) },
      pricingDistrict: { findFirst: vi.fn(async () => ({ id: "district-chn" })) },
    });
    const service = buildService(prisma);
    const result = await service.resolveDistrict("builder-1");
    expect(result).toEqual({ ok: true, districtId: "district-chn" });
    expect(prisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ builderId: "builder-1", status: "ACTIVE" }) })
    );
  });
});
