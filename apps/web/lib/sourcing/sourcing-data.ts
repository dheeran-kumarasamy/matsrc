// Data-access layer for the sourcing tools.
//
// This is the ONLY sourcing module that touches Prisma. Everything above it
// (product-search, supplier-search, landed-cost, ranking) is pure, and the LLM
// only ever sees the output of those pure functions — so there is no path by
// which model output becomes a query (§3, §20).
//
// Reuses existing platform data rather than new sources:
//   - Product / PricingTier / SupplierProfile / SupplierRating via Prisma
//   - PricePoint.freight for real freight observations
//   - Brand + PricingDistrict master data to keep extraction grounded

import { prisma } from "@/lib/builder-db";

import type { SourcingMatchableListing } from "./product-search";
import type { SupplierListingRow } from "./supplier-search";
import type { FreightObservation } from "./price-lookup";

/** Master data used to keep requirement extraction grounded in reality. */
export type SourcingMasterData = {
  brands: string[];
  locations: string[];
};

/**
 * Loads real Brand names and real place names.
 *
 * Locations come from PricingDistrict (the platform's district master data, from
 * the pricing/AGNI module) plus the distinct SupplierProfile.region values that
 * actually exist. Both are real — the assistant never matches against an
 * invented gazetteer.
 */
export async function loadMasterData(): Promise<SourcingMasterData> {
  const [brands, districts, regions] = await Promise.all([
    prisma.brand.findMany({ where: { isActive: true }, select: { name: true } }),
    prisma.pricingDistrict.findMany({ select: { name: true }, take: 1000 }),
    prisma.supplierProfile.findMany({
      where: { region: { not: null } },
      select: { region: true },
      distinct: ["region"],
    }),
  ]);

  const locations = new Set<string>();
  for (const district of districts) {
    if (district.name) locations.add(district.name);
  }
  for (const supplier of regions) {
    if (supplier.region) locations.add(supplier.region);
  }

  return {
    brands: brands.map((brand) => brand.name).filter(Boolean),
    locations: Array.from(locations),
  };
}

/**
 * Mean SupplierRating (delivery + quality) per supplier, 0-5.
 *
 * Suppliers with no ratings are simply absent from the map — the caller maps
 * that to null, never to a default score.
 */
export async function loadSupplierRatings(): Promise<Map<string, number>> {
  const grouped = await prisma.supplierRating.groupBy({
    by: ["supplierId"],
    _avg: { deliveryRating: true, qualityRating: true },
  });

  const ratings = new Map<string, number>();
  for (const row of grouped) {
    const values = [row._avg.deliveryRating, row._avg.qualityRating].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
    if (values.length === 0) continue;
    ratings.set(row.supplierId, values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  return ratings;
}

/**
 * Loads active listings with everything the sourcing tools need, in both the
 * matcher shape and the supplier-search shape.
 *
 * Prisma is the source here (rather than the public listings feed) because the
 * sourcing tools need supplier region, tier pricing and stock together as typed
 * values — the public feed carries display-formatted strings.
 */
export async function loadSourcingListings(): Promise<{
  matchable: SourcingMatchableListing[];
  rows: SupplierListingRow[];
}> {
  const [products, ratings] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        unit: true,
        brand: true,
        grade: true,
        basePrice: true,
        stock: true,
        maxServiceableQty: true,
        isActive: true,
        canonicalProductId: true,
        updatedAt: true,
        category: { select: { name: true } },
        brandRef: { select: { name: true } },
        gradeRef: { select: { name: true } },
        unitRef: { select: { code: true } },
        pricingTiers: { select: { minQty: true, maxQty: true, tierPrice: true } },
        supplier: { select: { id: true, companyName: true, region: true, verifiedBadge: true } },
      },
      take: 2000,
    }),
    loadSupplierRatings(),
  ]);

  const matchable: SourcingMatchableListing[] = [];
  const rows: SupplierListingRow[] = [];

  for (const product of products) {
    const brand = product.brandRef?.name ?? product.brand ?? null;
    const grade = product.gradeRef?.name ?? product.grade ?? null;
    const unit = product.unitRef?.code ?? product.unit;
    const basePrice = Number(product.basePrice);

    matchable.push({
      id: product.id,
      name: product.name,
      category: product.category.name,
      brand: brand ?? undefined,
      grade: grade ?? "",
      active: product.isActive,
      unit,
      canonicalProductId: product.canonicalProductId,
      supplierId: product.supplier.id,
      updatedAt: product.updatedAt.toISOString(),
      basePriceRaw: Number.isFinite(basePrice) ? basePrice : undefined,
    });

    rows.push({
      productId: product.id,
      productName: product.name,
      supplierId: product.supplier.id,
      supplierName: product.supplier.companyName,
      supplierRegion: product.supplier.region,
      verifiedBadge: product.supplier.verifiedBadge,
      isActive: product.isActive,
      unit,
      brand,
      grade,
      basePrice: Number.isFinite(basePrice) ? basePrice : null,
      stock: product.stock,
      maxServiceableQty: product.maxServiceableQty,
      pricingTiers: product.pricingTiers.map((tier) => ({
        minQty: tier.minQty,
        maxQty: tier.maxQty,
        tierPrice: Number(tier.tierPrice),
      })),
      historicalRating: ratings.get(product.supplier.id) ?? null,
      // No per-supplier lead-time model exists in this schema; only real
      // SupplierQuote lead times (loaded below) ever populate this.
      leadTimeDays: null,
    });
  }

  return { matchable, rows };
}

/**
 * Real observed lead times per supplier, derived from existing
 * SupplierQuote.leadTimeDays rows (the only lead-time data this schema holds).
 *
 * Uses the most recent quoted lead time per supplier. Suppliers who have never
 * quoted a lead time are absent — their delivery time stays null and the ranking
 * engine records a data gap, rather than assuming a delivery promise the
 * supplier never made.
 */
export async function loadSupplierLeadTimes(): Promise<Map<string, number>> {
  const quotes = await prisma.supplierQuote.findMany({
    where: { leadTimeDays: { not: null } },
    select: { supplierId: true, leadTimeDays: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const leadTimes = new Map<string, number>();
  for (const quote of quotes) {
    if (quote.leadTimeDays === null) continue;
    // First occurrence wins because the query is ordered newest-first.
    if (!leadTimes.has(quote.supplierId)) {
      leadTimes.set(quote.supplierId, quote.leadTimeDays);
    }
  }

  return leadTimes;
}

/**
 * Real freight observations for a set of products, from PricePoint — the only
 * table in this schema that records freight against a product/lane.
 */
export async function loadFreightObservations(
  productIds: string[]
): Promise<Map<string, FreightObservation[]>> {
  if (productIds.length === 0) return new Map();

  const points = await prisma.pricePoint.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, sourceCity: true, freight: true, recordedAt: true },
    orderBy: { recordedAt: "desc" },
    take: 500,
  });

  const byProduct = new Map<string, FreightObservation[]>();
  for (const point of points) {
    const freight = Number(point.freight);
    if (!Number.isFinite(freight) || freight <= 0) continue; // 0 freight is "not recorded", not "free"
    const existing = byProduct.get(point.productId) ?? [];
    existing.push({
      sourceCity: point.sourceCity,
      freight,
      recordedAt: point.recordedAt,
    });
    byProduct.set(point.productId, existing);
  }

  return byProduct;
}
