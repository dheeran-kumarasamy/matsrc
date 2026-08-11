import { prisma } from "@/lib/builder-db";
import { toMethodLabel, computeFreshness } from "@/lib/district-pricing";

// Phase 6D: Watchlist Price Intelligence enrichment helpers.
//
// Mirrors (does not duplicate business rules from, only the resolution
// pattern of) apps/web/app/api/builder/products/[canonicalProductId]/district-pricing/route.ts
// and the NestJS-side apps/api/src/pricing/alerting/watchlist-bridge.service.ts.
// Kept intentionally small and read-only — no schema changes, no writes.

export type WatchlistPriceIntelligence = {
  resolved: boolean;
  emptyReason: "NO_SKU_MATCH" | "NO_DISTRICT" | "NO_DISTRICT_DATA" | null;
  districtName: string | null;
  priceDate: string | null;
  currentPricePerBaseUnit: number | null;
  baseUnit: string | null;
  confidence: string | null;
  method: string | null;
  methodLabel: string | null;
  publicDisplayAllowed: boolean | null;
  isStale: boolean | null;
  gapToTarget: number | null;
  gapToTargetPct: number | null;
  /// Phase 6F — Geographic Pricing Hierarchy. DISTRICT unless a STATE
  /// fallback was used (see docs/pricing/geographic-pricing-hierarchy.md).
  geographyLevel: "DISTRICT" | "STATE" | null;
  /// Name of the state a STATE-level reference price belongs to. Null for a
  /// DISTRICT-level price.
  geographyStateName: string | null;
  /// True only when this price came from a STATE fallback rather than a
  /// direct district-specific observation.
  isGeographyFallback: boolean;
};

const EMPTY: WatchlistPriceIntelligence = {
  resolved: false,
  emptyReason: "NO_SKU_MATCH",
  districtName: null,
  priceDate: null,
  currentPricePerBaseUnit: null,
  baseUnit: null,
  confidence: null,
  method: null,
  methodLabel: null,
  publicDisplayAllowed: null,
  isStale: null,
  gapToTarget: null,
  gapToTargetPct: null,
  geographyLevel: null,
  geographyStateName: null,
  isGeographyFallback: false,
};

// Step 1: resolve Product -> PricingCanonicalSku.
// Exact match on matsrcListingId, then unambiguous category+brand fallback.
// Never guesses between multiple candidates.
async function resolveCanonicalSkuId(productId: string): Promise<string | null> {
  const exact = await prisma.pricingCanonicalSku.findFirst({
    where: { matsrcListingId: productId },
    select: { id: true },
  });
  if (exact) return exact.id;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      canonicalProduct: {
        select: {
          category: { select: { name: true } },
          brand: { select: { name: true } },
        },
      },
    },
  });

  const categoryName = product?.canonicalProduct?.category?.name?.trim();
  const brandName = product?.canonicalProduct?.brand?.name?.trim();
  if (!categoryName) return null;

  const candidates = await prisma.pricingCanonicalSku.findMany({
    where: {
      isActive: true,
      materialCategory: { name: { equals: categoryName, mode: "insensitive" } },
      ...(brandName ? { brand: { name: { equals: brandName, mode: "insensitive" } } } : {}),
    },
    select: { id: true },
    take: 2,
  });

  return candidates.length === 1 ? candidates[0].id : null;
}

// Step 2: resolve builder -> district, using the single most-recently-created
// ACTIVE Site with a non-null city (approved heuristic — mirrors
// watchlist-bridge.service.ts on the NestJS side).
async function resolveDistrictId(builderId: string): Promise<{ id: string; name: string; stateId: string } | null> {
  const site = await prisma.site.findFirst({
    where: { builderId, status: "ACTIVE", city: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { city: true },
  });
  if (!site?.city) return null;

  const district = await prisma.pricingDistrict.findFirst({
    where: { name: { equals: site.city, mode: "insensitive" } },
    select: { id: true, name: true, stateId: true },
  });
  return district ?? null;
}

/**
 * Resolve current Price Intelligence data for a single watchlist item.
 * Read-only, safe to call in a loop for small watchlists; batched variants
 * can be added later if performance requires it.
 */
export async function getWatchlistPriceIntelligence(
  productId: string,
  builderId: string,
  targetPrice: number | null
): Promise<WatchlistPriceIntelligence> {
  const skuId = await resolveCanonicalSkuId(productId);
  if (!skuId) return EMPTY;

  const district = await resolveDistrictId(builderId);
  if (!district) return { ...EMPTY, emptyReason: "NO_DISTRICT" };

  // Phase 6F — Geographic Pricing Hierarchy: DISTRICT price first, STATE
  // fallback second. Never presented as a district price when it isn't one.
  let currentRow = await prisma.pricingDistrictPriceDaily.findFirst({
    where: { canonicalSkuId: skuId, geographyLevel: "DISTRICT", districtId: district.id, publicDisplayAllowed: true },
    orderBy: { priceDate: "desc" },
  });
  let isGeographyFallback = false;
  let geographyStateName: string | null = null;

  if (!currentRow) {
    const stateRow = await prisma.pricingDistrictPriceDaily.findFirst({
      where: { canonicalSkuId: skuId, geographyLevel: "STATE", stateId: district.stateId, publicDisplayAllowed: true },
      orderBy: { priceDate: "desc" },
    });
    if (stateRow) {
      currentRow = stateRow;
      isGeographyFallback = true;
      const state = await prisma.pricingState.findUnique({ where: { id: district.stateId }, select: { name: true } });
      geographyStateName = state?.name ?? null;
    }
  }

  if (!currentRow) {
    return { ...EMPTY, emptyReason: "NO_DISTRICT_DATA", districtName: district.name };
  }

  const currentPrice = Number(currentRow.medianPerBaseUnit);
  const freshness = computeFreshness(currentRow.priceDate, new Date(), 24 * 3);

  let gapToTarget: number | null = null;
  let gapToTargetPct: number | null = null;
  if (targetPrice !== null && !Number.isNaN(targetPrice)) {
    gapToTarget = currentPrice - targetPrice;
    gapToTargetPct = targetPrice !== 0 ? (gapToTarget / targetPrice) * 100 : null;
  }

  return {
    resolved: true,
    emptyReason: null,
    districtName: district.name,
    priceDate: currentRow.priceDate.toISOString().slice(0, 10),
    currentPricePerBaseUnit: currentPrice,
    baseUnit: currentRow.baseUnit,
    confidence: currentRow.confidence,
    method: currentRow.method,
    methodLabel: toMethodLabel(currentRow.method),
    publicDisplayAllowed: currentRow.publicDisplayAllowed,
    isStale: freshness.isStale,
    gapToTarget,
    gapToTargetPct,
    geographyLevel: currentRow.geographyLevel as "DISTRICT" | "STATE",
    geographyStateName,
    isGeographyFallback,
  };
}
