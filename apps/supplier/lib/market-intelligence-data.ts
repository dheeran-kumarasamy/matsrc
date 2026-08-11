// Phase 6B — Supplier Portal "Market Intelligence" read-only data layer.
//
// SECURITY (spec §18): every query in this file filters on
// `publicDisplayAllowed: true` (same gating column the public builder-facing
// API uses) and only ever selects aggregate statistics already computed by
// the pricing serving layer (PricingDistrictPriceDaily / PricingTrendMonthly
// — median/p25/p75/observationCount/confidence). Nothing here ever touches
// PricingObservation (raw per-source rows) or any other supplier's Product/
// listing data, so no competitor identity, competitor price, or
// INTERNAL_ONLY-licensed observation can ever reach a supplier response.
//
// Kept in its own file (rather than growing supplier-data.ts further) so the
// Phase 6B surface area is easy to review/audit in isolation. Reuses
// ensureSupplierContext from supplier-data.ts for auth/context resolution —
// the same pattern as every other supplier-data.ts function.

import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "./supplier-data";
import {
  computeMarketPositionBucket,
  computeSuggestedPricingBand,
  computeOpportunityScore,
  computeVolatilityPct,
  computeTrendDirection,
  type MarketPositionBucket,
  type SuggestedPricingBand,
  type OpportunityLevel,
  type TrendDirection,
  MARKET_POSITION_LABELS,
} from "./pricing-intelligence";

type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

type CanonicalSkuRef = {
  id: string;
  code: string;
  materialCategoryId: string;
  materialCategory: { name: string } | null;
};

async function resolveSupplierCanonicalSkus(supplierProfileId: string) {
  const myProducts = await prisma.product.findMany({
    where: { supplierId: supplierProfileId, isActive: true },
    select: { id: true, name: true, basePrice: true, unit: true, category: { select: { id: true, name: true } } },
  });

  if (myProducts.length === 0) {
    return {
      myProducts,
      canonicalSkuByProductId: new Map<string, CanonicalSkuRef>(),
      canonicalSkusByCategoryName: new Map<string, CanonicalSkuRef[]>(),
    };
  }


  const myProductIds = myProducts.map((p) => p.id);
  const myCategoryNames = Array.from(
    new Set(myProducts.map((p) => p.category?.name).filter((n): n is string => Boolean(n)))
  );

  const directSkus = await prisma.pricingCanonicalSku.findMany({
    where: { matsrcListingId: { in: myProductIds } },
    select: { id: true, code: true, materialCategoryId: true, materialCategory: { select: { name: true } } },
  });

  const canonicalSkuByProductId = new Map<string, CanonicalSkuRef>();
  // matsrcListingId is 1:1 in practice; map back by scanning products for a match.
  for (const sku of directSkus) {
    const product = myProducts.find((p) => p.id === (sku as any).matsrcListingId);
    if (product) canonicalSkuByProductId.set(product.id, sku);
  }

  const fallbackSkus: CanonicalSkuRef[] =
    myCategoryNames.length > 0
      ? await prisma.pricingCanonicalSku.findMany({
          where: {
            isActive: true,
            materialCategory: { name: { in: myCategoryNames, mode: "insensitive" } },
          },
          select: { id: true, code: true, materialCategoryId: true, materialCategory: { select: { name: true } } },
          take: 100,
        })
      : [];

  const canonicalSkusByCategoryName = new Map<string, CanonicalSkuRef[]>();

  for (const sku of fallbackSkus) {
    const key = sku.materialCategory?.name.toLowerCase() ?? "";
    const existing = canonicalSkusByCategoryName.get(key) ?? [];
    existing.push(sku);
    canonicalSkusByCategoryName.set(key, existing);
  }

  return { myProducts, canonicalSkuByProductId, canonicalSkusByCategoryName };
}

// ─────────────────────────────────────────────
// 1. Listing Competitiveness Report (spec §2, §3, §4)
// ─────────────────────────────────────────────

export type ListingCompetitivenessRow = {
  listingId: string;
  listingName: string;
  category: string;
  districtCode: string;
  districtName: string;
  baseUnit: string;
  currentSellingPrice: number;
  marketMedian: number;
  p25: number | null;
  p75: number | null;
  diff: number;
  diffPct: number;
  marketPosition: MarketPositionBucket;
  marketPositionLabel: string;
  confidence: ConfidenceLevel;
  method: string;
  observationCount: number;
  trendDirection: TrendDirection | null;
  lastUpdated: string;
  suggestedBand: SuggestedPricingBand;
  opportunity: { score: number; level: OpportunityLevel; explanation: string };
};

export async function getListingCompetitiveness(email: string): Promise<ListingCompetitivenessRow[]> {
  const { supplierProfile } = await ensureSupplierContext(email);
  const { myProducts, canonicalSkuByProductId, canonicalSkusByCategoryName } =
    await resolveSupplierCanonicalSkus(supplierProfile.id);

  if (myProducts.length === 0) return [];

  const rows: ListingCompetitivenessRow[] = [];

  for (const product of myProducts) {
    const directSku = canonicalSkuByProductId.get(product.id);
    const fallbackSkus = product.category
      ? canonicalSkusByCategoryName.get(product.category.name.toLowerCase()) ?? []
      : [];
    const candidateSkus = directSku ? [directSku] : fallbackSkus.slice(0, 3);

    if (candidateSkus.length === 0) continue;

    const canonicalSkuIds = candidateSkus.map((s) => s.id);

    // Phase 6F: this district-competitiveness view is district-scoped by
    // design — only DISTRICT-level rows participate; a STATE/NATIONAL
    // reference row (districtId=null) is out of scope here rather than
    // silently mapped onto a district.
    const latestDaily = await prisma.pricingDistrictPriceDaily.findMany({
      where: { canonicalSkuId: { in: canonicalSkuIds }, geographyLevel: "DISTRICT", publicDisplayAllowed: true },
      orderBy: { priceDate: "desc" },
      take: 100,
      include: { district: { select: { code: true, name: true } } },
    });

    const seenDistricts = new Set<string>();
    for (const row of latestDaily) {
      if (!row.districtId || !row.district) continue;
      if (seenDistricts.has(row.districtId)) continue;
      seenDistricts.add(row.districtId);

      const sellingPrice = Number(product.basePrice);
      const median = Number(row.medianPerBaseUnit);
      const p25 = row.p25PerBaseUnit !== null ? Number(row.p25PerBaseUnit) : null;
      const p75 = row.p75PerBaseUnit !== null ? Number(row.p75PerBaseUnit) : null;

      const { bucket, diffPct } = computeMarketPositionBucket(sellingPrice, median, p25, p75);

      const trendRows = await prisma.pricingTrendMonthly.findMany({
        where: { canonicalSkuId: row.canonicalSkuId, geographyLevel: "DISTRICT", districtId: row.districtId },
        orderBy: { monthStart: "desc" },
        take: 6,
      });
      const ascendingMedians = trendRows
        .slice()
        .reverse()
        .map((t) => Number(t.medianPerBaseUnit));
      const trendDirection = computeTrendDirection(ascendingMedians);
      const volatilityPct = computeVolatilityPct(trendRows.map((t) => (t.momChangePct !== null ? Number(t.momChangePct) : null)));

      const suggestedBand = computeSuggestedPricingBand(
        median,
        p25,
        p75,
        row.minPerBaseUnit !== null ? Number(row.minPerBaseUnit) : null,
        row.maxPerBaseUnit !== null ? Number(row.maxPerBaseUnit) : null
      );

      const opportunity = computeOpportunityScore({
        observationCount: row.observationCount,
        confidence: row.confidence,
        districtCoverageCount: seenDistricts.size,
        hasSupplierPresence: true, // this row IS the supplier's own listing
        volatilityPct,
        trendDirection,
      });

      rows.push({
        listingId: product.id,
        listingName: product.name,
        category: product.category?.name ?? "—",
        districtCode: row.district.code,
        districtName: row.district.name,
        baseUnit: row.baseUnit,
        currentSellingPrice: sellingPrice,
        marketMedian: median,
        p25,
        p75,
        diff: Number((sellingPrice - median).toFixed(2)),
        diffPct: Number(diffPct.toFixed(2)),
        marketPosition: bucket,
        marketPositionLabel: MARKET_POSITION_LABELS[bucket],
        confidence: row.confidence,
        method: row.method,
        observationCount: row.observationCount,
        trendDirection,
        lastUpdated: row.priceDate.toISOString().slice(0, 10),
        suggestedBand,
        opportunity,
      });
    }
  }

  rows.sort((a, b) => a.listingName.localeCompare(b.listingName) || a.districtName.localeCompare(b.districtName));
  return rows;
}

// ─────────────────────────────────────────────
// 2. Category Trend Report (spec §5)
// ─────────────────────────────────────────────

export type CategoryTrendRow = {
  category: string;
  districtCode: string;
  districtName: string;
  monthlyMedians: { monthStart: string; medianPerBaseUnit: number }[];
  changePct: number | null;
  highestMonth: { monthStart: string; medianPerBaseUnit: number } | null;
  lowestMonth: { monthStart: string; medianPerBaseUnit: number } | null;
  volatilityPct: number | null;
  confidence: ConfidenceLevel;
  observationCount: number;
};

export async function getCategoryTrendReport(email: string): Promise<CategoryTrendRow[]> {
  const { supplierProfile } = await ensureSupplierContext(email);
  const { myProducts, canonicalSkuByProductId, canonicalSkusByCategoryName } =
    await resolveSupplierCanonicalSkus(supplierProfile.id);

  if (myProducts.length === 0) return [];

  // PricingTrendMonthly has no `canonicalSku` relation field to `include`, so
  // build a skuId -> categoryName lookup from data we already fetched above
  // (canonicalSkuByProductId / canonicalSkusByCategoryName both carry
  // materialCategory.name) instead of an (invalid) Prisma include.
  const categoryNameBySkuId = new Map<string, string>();
  for (const sku of canonicalSkuByProductId.values()) {
    categoryNameBySkuId.set(sku.id, sku.materialCategory?.name ?? "Unknown");
  }
  for (const skus of canonicalSkusByCategoryName.values()) {
    for (const sku of skus) {
      categoryNameBySkuId.set(sku.id, sku.materialCategory?.name ?? "Unknown");
    }
  }

  const allSkuIds = new Set<string>(categoryNameBySkuId.keys());

  if (allSkuIds.size === 0) return [];

  // Phase 6F: category-trend view is district-scoped by design; only
  // DISTRICT-level trend rows participate here.
  const trendRows = await prisma.pricingTrendMonthly.findMany({
    where: { canonicalSkuId: { in: Array.from(allSkuIds) }, geographyLevel: "DISTRICT" },
    orderBy: { monthStart: "desc" },
    take: 1200,
  });

  const districtLookup = await prisma.pricingDistrict.findMany({ select: { id: true, code: true, name: true } });
  const districtById = new Map(districtLookup.map((d) => [d.id, d]));

  const grouped = new Map<string, typeof trendRows>();
  for (const row of trendRows) {
    if (!row.districtId) continue;
    const categoryName = categoryNameBySkuId.get(row.canonicalSkuId) ?? "Unknown";
    const key = `${categoryName}:${row.districtId}`;
    const existing: typeof trendRows = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }


  const results: CategoryTrendRow[] = [];
  for (const [key, rowsForKey] of grouped.entries()) {
    const [categoryName] = key.split(":");
    const firstDistrictId = rowsForKey[0].districtId;
    const district = firstDistrictId ? districtById.get(firstDistrictId) : undefined;
    if (!district) continue;

    const sorted = rowsForKey
      .slice()
      .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime())
      .slice(-12);

    const monthlyMedians = sorted.map((r) => ({
      monthStart: r.monthStart.toISOString().slice(0, 7),
      medianPerBaseUnit: Number(r.medianPerBaseUnit),
    }));

    if (monthlyMedians.length === 0) continue;

    const highest = monthlyMedians.reduce((max, m) => (m.medianPerBaseUnit > max.medianPerBaseUnit ? m : max));
    const lowest = monthlyMedians.reduce((min, m) => (m.medianPerBaseUnit < min.medianPerBaseUnit ? m : min));
    const changePct =
      monthlyMedians.length >= 2
        ? Number(
            (
              ((monthlyMedians[monthlyMedians.length - 1].medianPerBaseUnit - monthlyMedians[0].medianPerBaseUnit) /
                monthlyMedians[0].medianPerBaseUnit) *
              100
            ).toFixed(2)
          )
        : null;

    const volatilityPct = computeVolatilityPct(sorted.map((r) => (r.momChangePct !== null ? Number(r.momChangePct) : null)));

    const confidenceOrder: Record<ConfidenceLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    const worstConfidence = sorted.reduce<ConfidenceLevel>(
      (worst, r) => (confidenceOrder[r.confidence] < confidenceOrder[worst] ? r.confidence : worst),
      "HIGH"
    );

    results.push({
      category: categoryName,
      districtCode: district.code,
      districtName: district.name,
      monthlyMedians,
      changePct,
      highestMonth: highest,
      lowestMonth: lowest,
      volatilityPct,
      confidence: worstConfidence,
      observationCount: sorted.reduce((sum, r) => sum + r.dayCount, 0),
    });
  }

  results.sort((a, b) => a.category.localeCompare(b.category) || a.districtName.localeCompare(b.districtName));
  return results;
}

// ─────────────────────────────────────────────
// 3. District Opportunity Report (spec §6)
//
// Interpretation note: the Product model has no district field (listings are
// not district-scoped in the current schema), so "no active listing" is
// evaluated at the category level — districts where market data exists for
// one of the supplier's listing categories, i.e. a category the supplier
// already sells, but expressed through a canonical SKU the supplier is not
// directly linked to (matsrcListingId not pointing at any of their products)
// — meaning stronger fulfilment demand elsewhere they aren't yet capturing.
// ─────────────────────────────────────────────

export type DistrictOpportunityRow = {
  districtCode: string;
  districtName: string;
  category: string;
  medianPrice: number;
  trendDirection: TrendDirection | null;
  confidence: ConfidenceLevel;
  opportunityScore: number;
  opportunityLevel: OpportunityLevel;
  reason: string;
};

export async function getDistrictOpportunityReport(email: string): Promise<DistrictOpportunityRow[]> {
  const { supplierProfile } = await ensureSupplierContext(email);
  const { myProducts, canonicalSkuByProductId, canonicalSkusByCategoryName } =
    await resolveSupplierCanonicalSkus(supplierProfile.id);

  if (myProducts.length === 0) return [];

  const myDirectSkuIds = new Set(Array.from(canonicalSkuByProductId.values()).map((s) => s.id));

  const results: DistrictOpportunityRow[] = [];

  for (const [categoryKey, skus] of canonicalSkusByCategoryName.entries()) {
    const skuIds = skus.map((s) => s.id);
    if (skuIds.length === 0) continue;

    // Phase 6F: district-opportunity report is district-scoped by design.
    const latestDaily = await prisma.pricingDistrictPriceDaily.findMany({
      where: { canonicalSkuId: { in: skuIds }, geographyLevel: "DISTRICT", publicDisplayAllowed: true },
      orderBy: { priceDate: "desc" },
      take: 100,
      include: { district: { select: { code: true, name: true } } },
    });

    const seenDistricts = new Set<string>();
    for (const row of latestDaily) {
      if (!row.districtId || !row.district) continue;
      // Skip districts already covered by the supplier's own directly-linked SKU.
      if (myDirectSkuIds.has(row.canonicalSkuId)) continue;
      if (seenDistricts.has(row.districtId)) continue;
      seenDistricts.add(row.districtId);

      const trendRows = await prisma.pricingTrendMonthly.findMany({
        where: { canonicalSkuId: row.canonicalSkuId, geographyLevel: "DISTRICT", districtId: row.districtId },
        orderBy: { monthStart: "desc" },
        take: 6,
      });
      const ascendingMedians = trendRows
        .slice()
        .reverse()
        .map((t) => Number(t.medianPerBaseUnit));
      const trendDirection = computeTrendDirection(ascendingMedians);
      const volatilityPct = computeVolatilityPct(
        trendRows.map((t) => (t.momChangePct !== null ? Number(t.momChangePct) : null))
      );

      const opportunity = computeOpportunityScore({
        observationCount: row.observationCount,
        confidence: row.confidence,
        districtCoverageCount: seenDistricts.size,
        hasSupplierPresence: false,
        volatilityPct,
        trendDirection,
      });

      results.push({
        districtCode: row.district.code,
        districtName: row.district.name,
        category: categoryKey.replace(/\b\w/g, (c: string) => c.toUpperCase()),

        medianPrice: Number(row.medianPerBaseUnit),
        trendDirection,
        confidence: row.confidence,
        opportunityScore: opportunity.score,
        opportunityLevel: opportunity.level,
        reason: opportunity.explanation,
      });
    }
  }

  results.sort((a, b) => b.opportunityScore - a.opportunityScore);
  return results;
}

// ─────────────────────────────────────────────
// 4. Dashboard Summary KPIs (spec §1)
// ─────────────────────────────────────────────

export type MarketIntelligenceSummary = {
  activeListings: number;
  listingsCompared: number;
  competitiveListings: number; // WITHIN_MARKET
  overpricedListings: number; // ABOVE_MARKET or MUCH_ABOVE_MARKET
  underpricedListings: number; // BELOW_MARKET or MUCH_BELOW_MARKET
  districtsCovered: number;
  categoriesCovered: number;
  averageMarketPositionLabel: string;
  averageConfidence: ConfidenceLevel | "—";
  lastUpdated: string | null;
};

export async function getMarketIntelligenceSummary(email: string): Promise<MarketIntelligenceSummary> {
  const { supplierProfile } = await ensureSupplierContext(email);
  const activeListings = await prisma.product.count({ where: { supplierId: supplierProfile.id, isActive: true } });

  const rows = await getListingCompetitiveness(email);

  const districtsCovered = new Set(rows.map((r) => r.districtCode)).size;
  const categoriesCovered = new Set(rows.map((r) => r.category)).size;

  const competitiveListings = rows.filter((r) => r.marketPosition === "WITHIN_MARKET").length;
  const overpricedListings = rows.filter(
    (r) => r.marketPosition === "ABOVE_MARKET" || r.marketPosition === "MUCH_ABOVE_MARKET"
  ).length;
  const underpricedListings = rows.filter(
    (r) => r.marketPosition === "BELOW_MARKET" || r.marketPosition === "MUCH_BELOW_MARKET"
  ).length;

  const positionScore: Record<MarketPositionBucket, number> = {
    MUCH_BELOW_MARKET: -2,
    BELOW_MARKET: -1,
    WITHIN_MARKET: 0,
    ABOVE_MARKET: 1,
    MUCH_ABOVE_MARKET: 2,
  };
  const avgScore = rows.length > 0 ? rows.reduce((sum, r) => sum + positionScore[r.marketPosition], 0) / rows.length : 0;
  const averageMarketPositionLabel =
    rows.length === 0
      ? "No data"
      : avgScore <= -1.5
        ? MARKET_POSITION_LABELS.MUCH_BELOW_MARKET
        : avgScore <= -0.5
          ? MARKET_POSITION_LABELS.BELOW_MARKET
          : avgScore < 0.5
            ? MARKET_POSITION_LABELS.WITHIN_MARKET
            : avgScore < 1.5
              ? MARKET_POSITION_LABELS.ABOVE_MARKET
              : MARKET_POSITION_LABELS.MUCH_ABOVE_MARKET;

  const confidenceScore: Record<ConfidenceLevel, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };
  const avgConfidenceScore =
    rows.length > 0 ? rows.reduce((sum, r) => sum + confidenceScore[r.confidence], 0) / rows.length : -1;
  const averageConfidence: ConfidenceLevel | "—" =
    rows.length === 0 ? "—" : avgConfidenceScore >= 1.5 ? "HIGH" : avgConfidenceScore >= 0.5 ? "MEDIUM" : "LOW";

  const lastUpdated =
    rows.length > 0 ? rows.map((r) => r.lastUpdated).sort().reverse()[0] : null;

  return {
    activeListings,
    listingsCompared: rows.length,
    competitiveListings,
    overpricedListings,
    underpricedListings,
    districtsCovered,
    categoriesCovered,
    averageMarketPositionLabel,
    averageConfidence,
    lastUpdated,
  };
}

// ─────────────────────────────────────────────
// 5. RFQ Quote Assist — market guidance only (spec §7)
// ─────────────────────────────────────────────

export type RfqMarketGuidance = {
  districtMedian: number | null;
  p25: number | null;
  p75: number | null;
  confidence: ConfidenceLevel | null;
  trendDirection: TrendDirection | null;
  observationCount: number | null;
  suggestedBand: SuggestedPricingBand | null;
  lastUpdated: string | null;
} | null;

export async function getRfqMarketGuidance(materialName: string): Promise<RfqMarketGuidance> {
  const sku = await prisma.pricingCanonicalSku.findFirst({
    where: {
      isActive: true,
      OR: [
        { materialCategory: { name: { equals: materialName, mode: "insensitive" } } },
        { materialCategory: { name: { contains: materialName, mode: "insensitive" } } },
      ],
    },
    select: { id: true },
  });
  if (!sku) return null;

  const latest = await prisma.pricingDistrictPriceDaily.findFirst({
    where: { canonicalSkuId: sku.id, publicDisplayAllowed: true },
    orderBy: { priceDate: "desc" },
  });
  if (!latest) return null;

  const trendRows = await prisma.pricingTrendMonthly.findMany({
    where: { canonicalSkuId: sku.id, districtId: latest.districtId },
    orderBy: { monthStart: "desc" },
    take: 6,
  });
  const ascendingMedians = trendRows
    .slice()
    .reverse()
    .map((t) => Number(t.medianPerBaseUnit));
  const trendDirection = computeTrendDirection(ascendingMedians);

  const median = Number(latest.medianPerBaseUnit);
  const p25 = latest.p25PerBaseUnit !== null ? Number(latest.p25PerBaseUnit) : null;
  const p75 = latest.p75PerBaseUnit !== null ? Number(latest.p75PerBaseUnit) : null;

  return {
    districtMedian: median,
    p25,
    p75,
    confidence: latest.confidence,
    trendDirection,
    observationCount: latest.observationCount,
    suggestedBand: computeSuggestedPricingBand(
      median,
      p25,
      p75,
      latest.minPerBaseUnit !== null ? Number(latest.minPerBaseUnit) : null,
      latest.maxPerBaseUnit !== null ? Number(latest.maxPerBaseUnit) : null
    ),
    lastUpdated: latest.priceDate.toISOString().slice(0, 10),
  };
}
