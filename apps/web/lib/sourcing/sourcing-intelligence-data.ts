// sourcing-intelligence-data.ts — Prisma data access for Phase 8 price
// intelligence. The ONLY module in lib/sourcing/ that touches Prisma for
// the intelligence layer (sourcing-data.ts handles the catalogue/supplier side).
//
// Queries PricingDistrictPriceDaily (the existing serving layer) for a
// canonical SKU + district within a date window. Only publicDisplayAllowed
// rows are returned — same gate as the district-pricing route.

import { prisma } from "@/lib/builder-db";
import type { Prisma } from "@matsrc/db";
import type { PricingDailyRow } from "./price-history";

type SkuWhereInput = Prisma.PricingCanonicalSkuWhereInput;

/**
 * Given a set of >1 candidate ids that are all otherwise equally plausible
 * (same category/grade/brand match), narrows to whichever ones actually have
 * at least one publicDisplayAllowed PricingDistrictPriceDaily row. This never
 * picks a "close enough" size/spec variant or fabricates a match — it only
 * resolves genuine ambiguity (e.g. several size variants of the same grade,
 * like 6mm/8mm/12mm/... TMT bars, none of which the marketplace side records
 * a size for) down to the single one the pricing pipeline actually has real,
 * displayable history for. If more than one (or none) of the candidates has
 * data, the ambiguity is real and this still returns null.
 */
async function narrowToCandidateWithData(ids: string[]): Promise<string | null> {
  const withData = await prisma.pricingCanonicalSku.findMany({
    where: {
      id: { in: ids },
      dailyPrices: { some: { publicDisplayAllowed: true } },
    },
    select: { id: true },
    take: 2,
  });
  return withData.length === 1 ? withData[0].id : null;
}

/**
 * Runs a PricingCanonicalSku lookup and only accepts the result when it is
 * unambiguous. Tries the caller's `brandFilter` first (when a brand is known)
 * and, if that yields nothing, retries the same `whereBase` without it — many
 * real PricingCanonicalSku rows are brand-agnostic ("_GENERIC" SKUs), so
 * requiring a brand match would otherwise discard a genuine unambiguous hit.
 * When a filter step yields several candidates (e.g. multiple size variants
 * of the same grade), falls back to narrowToCandidateWithData() before
 * giving up on that step. Never guesses between multiple candidates.
 */
async function matchUnambiguous(
  whereBase: SkuWhereInput,
  brandFilter: SkuWhereInput
): Promise<string | null> {
  if (Object.keys(brandFilter).length > 0) {
    const withBrand = await prisma.pricingCanonicalSku.findMany({
      where: { ...whereBase, ...brandFilter },
      select: { id: true },
      take: 20,
    });
    if (withBrand.length === 1) return withBrand[0].id;
    if (withBrand.length > 1) {
      const narrowed = await narrowToCandidateWithData(withBrand.map((c) => c.id));
      if (narrowed) return narrowed;
    }
  }

  const withoutBrand = await prisma.pricingCanonicalSku.findMany({
    where: whereBase,
    select: { id: true },
    take: 20,
  });
  if (withoutBrand.length === 1) return withoutBrand[0].id;
  if (withoutBrand.length > 1) {
    return narrowToCandidateWithData(withoutBrand.map((c) => c.id));
  }
  return null;
}

/**
 * Resolves a CanonicalProduct → PricingCanonicalSku via:
 *   1. Exact: PricingCanonicalSku.matsrcListingId === canonicalProductId
 *   2. Fuzzy: category name (+ brand name when known)
 *   3. Fuzzy fallback: grade name against the LEAF PricingMaterialCategory
 *      (+ brand name when known)
 *   4. Fuzzy fallback: PricingCanonicalSku.grade field, scoped to a
 *      materialCategory whose name or PARENT name matches the marketplace
 *      category (+ brand name when known)
 *
 * WHY (3) AND (4) EXIST: the pricing schema's material-category tree is two
 * levels deep (e.g. "TMT Steel" -> "Fe 500"/"Fe 500D"/...) and every real
 * PricingCanonicalSku is attached to the LEAF (grade-level) category — never
 * to the flat top-level category the marketplace side uses ("TMT Bars").
 * Attempt (2) alone therefore only ever matches categories that happen to be
 * top-level in both trees (e.g. "Cement"), and silently misses grade-specific
 * families like TMT Steel even when real, publicDisplayAllowed daily price
 * history exists for that exact grade. (3)/(4) are additive fallbacks that
 * only run when (2) found nothing — they never replace or loosen (2)'s own
 * matching, and each step still requires an UNAMBIGUOUS single candidate.
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
      grade: { select: { name: true } },
    },
  });
  if (!product?.category?.name) return null;

  const brandFilter = product.brand?.name
    ? { brand: { name: { equals: product.brand.name, mode: "insensitive" as const } } }
    : {};

  // Attempt 2 (original): category name matched directly against
  // PricingMaterialCategory.name.
  const byCategoryMatch = await matchUnambiguous(
    {
      isActive: true,
      materialCategory: { name: { equals: product.category.name, mode: "insensitive" } },
    },
    brandFilter
  );
  if (byCategoryMatch) return byCategoryMatch;

  if (product.grade?.name) {
    // Attempt 3 (fallback): marketplace GRADE name against the leaf
    // PricingMaterialCategory.name (e.g. "Fe 500").
    const byGradeCategoryMatch = await matchUnambiguous(
      {
        isActive: true,
        materialCategory: { name: { equals: product.grade.name, mode: "insensitive" } },
      },
      brandFilter
    );
    if (byGradeCategoryMatch) return byGradeCategoryMatch;

    // Attempt 4 (fallback): PricingCanonicalSku.grade free-text field,
    // scoped to a materialCategory whose name OR PARENT name equals the
    // marketplace category — covers SKUs whose leaf category name doesn't
    // literally equal the grade string.
    const byGradeFieldMatch = await matchUnambiguous(
      {
        isActive: true,
        grade: { equals: product.grade.name, mode: "insensitive" },
        materialCategory: {
          OR: [
            { name: { equals: product.category.name, mode: "insensitive" } },
            { parent: { name: { equals: product.category.name, mode: "insensitive" } } },
          ],
        },
      },
      brandFilter
    );
    if (byGradeFieldMatch) return byGradeFieldMatch;

    // Attempt 5 (fallback): BIDIRECTIONAL loose substring match on the
    // marketplace grade name, since grade labels aren't always byte-identical
    // across the two systems (e.g. marketplace "OPC 53 Grade" vs pricing leaf
    // category/grade field "OPC 53" — neither is a superstring-match of the
    // other via a one-directional SQL `contains`). Scopes candidates to SKUs
    // under a materialCategory whose name or PARENT name equals the
    // marketplace top-level category (same scoping as attempt 4), fetches
    // them, and only then compares grade strings in both directions in
    // application code. Tries WITH the brand filter first, then without —
    // same reasoning as matchUnambiguous() (many real SKUs are brand-agnostic
    // "_GENERIC" rows). Still requires an unambiguous single result at each
    // step — never picks between several plausible loose matches.
    const gradeName = product.grade.name.trim().toLowerCase();
    const looseCategoryScope: SkuWhereInput = {
      isActive: true,
      materialCategory: {
        OR: [
          { name: { equals: product.category.name, mode: "insensitive" } },
          { parent: { name: { equals: product.category.name, mode: "insensitive" } } },
        ],
      },
    };

    async function findLooseGradeMatch(whereClause: SkuWhereInput): Promise<string | null> {
      const scopedCandidates = await prisma.pricingCanonicalSku.findMany({
        where: whereClause,
        select: { id: true, grade: true, materialCategory: { select: { name: true } } },
        take: 200,
      });

      const looseMatches = scopedCandidates.filter((candidate) => {
        const categoryName = candidate.materialCategory.name.trim().toLowerCase();
        const skuGrade = (candidate.grade ?? "").trim().toLowerCase();
        return (
          (categoryName.length > 0 &&
            (gradeName.includes(categoryName) || categoryName.includes(gradeName))) ||
          (skuGrade.length > 0 && (gradeName.includes(skuGrade) || skuGrade.includes(gradeName)))
        );
      });
      if (looseMatches.length === 1) return looseMatches[0].id;
      if (looseMatches.length > 1) {
        return narrowToCandidateWithData(looseMatches.map((c) => c.id));
      }
      return null;
    }

    if (product.brand?.name) {
      const withBrand = await findLooseGradeMatch({
        ...looseCategoryScope,
        brand: { name: { equals: product.brand.name, mode: "insensitive" } },
      });
      if (withBrand) return withBrand;
    }

    const looseGradeMatch = await findLooseGradeMatch(looseCategoryScope);
    if (looseGradeMatch) return looseGradeMatch;
  }

  return null;
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
