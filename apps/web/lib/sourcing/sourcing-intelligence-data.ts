// sourcing-intelligence-data.ts — Prisma data access for Phase 8 price
// intelligence. The ONLY module in lib/sourcing/ that touches Prisma for
// the intelligence layer (sourcing-data.ts handles the catalogue/supplier side).
//
// Queries PricingDistrictPriceDaily (the existing serving layer) for a
// canonical SKU + district within a date window. Only publicDisplayAllowed
// rows are returned — same gate as the district-pricing route.

import { prisma } from "@/lib/builder-db";
import type { PricingDailyRow } from "./price-history";

/**
 * Resolves a CanonicalProduct → PricingCanonicalSku via:
 *   1. Exact: PricingCanonicalSku.matsrcListingId === canonicalProductId
 *   2. Fuzzy: category name + brand name match
 *
 * Returns the canonical SKU id, or null when no match is found.
 * Never fabricates a match — the caller must handle null honestly.
 */
export async function resolveCanonicalSkuId(
  canonicalProductId: string
): Promise<string | null> {
  const exactSku = await prisma.pricingCanonicalSku.findFirst({
    where: { matsrcListingId: canonicalProductId, isActive: true },
    select: { id: true },
  });
  if (exactSku) return exactSku.id;

  const product = await prisma.canonicalProduct.findUnique({
    where: { id: canonicalProductId },
    select: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });
  if (!product?.category?.name) return null;

  const candidates = await prisma.pricingCanonicalSku.findMany({
    where: {
      isActive: true,
      materialCategory: { name: { equals: product.category.name, mode: "insensitive" } },
      ...(product.brand?.name
        ? { brand: { name: { equals: product.brand.name, mode: "insensitive" } } }
        : {}),
    },
    select: { id: true },
    take: 2,
  });
  // Only use the fuzzy match when it is unambiguous (exactly one candidate).
  return candidates.length === 1 ? candidates[0].id : null;
}

/**
 * Resolves a district name → PricingDistrict row.
 * Returns null when the district is not in the platform's master data.
 */
export async function resolveDistrictId(districtName: string): Promise<string | null> {
  if (!districtName) return null;
  const district = await prisma.pricingDistrict.findFirst({
    where: { name: { equals: districtName.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  return district?.id ?? null;
}

// P2-A (Market Benchmark) — additive lookups. Resolves the canonical SKU's
// public `code` and its material category id (needed to call the public
// `public/pricing/resolve` endpoint and to look up a genuine unit-conversion
// factor), and a district's public `code` (needed for the same call). Never
// guesses either — returns null when not found, same convention as
// resolveCanonicalSkuId/resolveDistrictId above.
export async function getCanonicalSkuMarketContext(
  canonicalSkuId: string
): Promise<{ code: string; materialCategoryId: string; baseUnit: string } | null> {
  const sku = await prisma.pricingCanonicalSku.findUnique({
    where: { id: canonicalSkuId },
    select: { code: true, materialCategoryId: true, baseUnit: true },
  });
  return sku ?? null;
}

export async function getDistrictCode(districtId: string): Promise<string | null> {
  const district = await prisma.pricingDistrict.findUnique({
    where: { id: districtId },
    select: { code: true },
  });
  return district?.code ?? null;
}

/**
 * Looks up a genuine unit-conversion factor from PricingUnitConversion for
 * converting one `fromUnitLabel` (e.g. the report's Product.unit, "MT") into
 * one base unit of the given material category. Case-insensitive match on
 * `fromLabel`. Returns null (never a guessed factor) when no verified
 * conversion row exists, or when the row is flagged `isAmbiguous` — an
 * ambiguous conversion is, by definition, not safe to apply automatically.
 */
export async function resolveUnitConversionFactor(
  materialCategoryId: string,
  fromUnitLabel: string
): Promise<number | null> {
  if (!fromUnitLabel) return null;
  const conversion = await prisma.pricingUnitConversion.findFirst({
    where: {
      materialCategoryId,
      fromLabel: { equals: fromUnitLabel.trim(), mode: "insensitive" },
      isAmbiguous: false,
    },
    select: { factor: true },
  });
  if (!conversion) return null;
  const factor = Number(conversion.factor);
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}

/**
 * Loads daily price rows for a canonical SKU and district over a trailing
 * window. Only publicDisplayAllowed rows are returned.
 *
 * Falls back to STATE-level rows when no DISTRICT rows are available,
 * matching the existing serving-layer fallback convention.
 */
export async function loadPriceHistoryRows(
  canonicalSkuId: string,
  districtId: string | null,
  periodDays: number
): Promise<PricingDailyRow[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - periodDays);

  const baseWhere = {
    canonicalSkuId,
    publicDisplayAllowed: true,
    priceDate: { gte: cutoffDate },
  };

  // Try district-level first.
  if (districtId) {
    const districtRows = await prisma.pricingDistrictPriceDaily.findMany({
      where: { ...baseWhere, districtId, geographyLevel: "DISTRICT" },
      orderBy: { priceDate: "asc" },
      take: 120,
      select: {
        priceDate: true,
        medianPerBaseUnit: true,
        p25PerBaseUnit: true,
        p75PerBaseUnit: true,
        minPerBaseUnit: true,
        maxPerBaseUnit: true,
        observationCount: true,
        sourceCount: true,
        confidence: true,
        method: true,
        publicDisplayAllowed: true,
      },
    });
    if (districtRows.length > 0) return mapRows(districtRows);
  }

  // Fall back to STATE-level rows.
  const stateRows = await prisma.pricingDistrictPriceDaily.findMany({
    where: { ...baseWhere, geographyLevel: "STATE" },
    orderBy: { priceDate: "asc" },
    take: 120,
    select: {
      priceDate: true,
      medianPerBaseUnit: true,
      p25PerBaseUnit: true,
      p75PerBaseUnit: true,
      minPerBaseUnit: true,
      maxPerBaseUnit: true,
      observationCount: true,
      sourceCount: true,
      confidence: true,
      method: true,
      publicDisplayAllowed: true,
    },
  });
  return mapRows(stateRows);
}

type RawRow = {
  priceDate: Date;
  medianPerBaseUnit: unknown;
  p25PerBaseUnit: unknown;
  p75PerBaseUnit: unknown;
  minPerBaseUnit: unknown;
  maxPerBaseUnit: unknown;
  observationCount: number;
  sourceCount: number;
  confidence: string;
  method: string;
  publicDisplayAllowed: boolean;
};

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRows(rows: RawRow[]): PricingDailyRow[] {
  return rows.map((r) => ({
    priceDate: r.priceDate,
    medianPerBaseUnit: Number(r.medianPerBaseUnit),
    p25PerBaseUnit: toNum(r.p25PerBaseUnit),
    p75PerBaseUnit: toNum(r.p75PerBaseUnit),
    minPerBaseUnit: toNum(r.minPerBaseUnit),
    maxPerBaseUnit: toNum(r.maxPerBaseUnit),
    observationCount: r.observationCount,
    sourceCount: r.sourceCount,
    confidence: r.confidence as PricingDailyRow["confidence"],
    method: r.method,
    publicDisplayAllowed: r.publicDisplayAllowed,
  }));
}
