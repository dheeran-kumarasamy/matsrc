// Shared data-fetching + aggregation logic for the 7 Builder "Reports"
// overlay reports (Material Consumption, Best Supplier Pricing, Potential
// Cost Savings, Live Market Prices, Regional Price Comparison, Historical
// Price Trends, District-Wise Price Intelligence).
//
// Extracted out of app/api/builder/reports/<id>/route.ts so the exact same
// query/aggregation logic can be reused by BOTH:
//   - the JSON API route the overlay fetches from (unchanged behaviour), and
//   - the new /api/builder/reports/[reportId]/export route (XLSX/PDF
//     download), so the exported file always matches what was on screen.
//
// No new business logic here — this is a pure refactor/extraction of the
// existing route handlers' bodies.

import { prisma } from "@/lib/builder-db";
import { getSupplierListings, parseListingPrice } from "@/lib/listings";
import { shouldShowSupplierNames } from "@/lib/report-flags";
import type {
  MaterialConsumptionRow,
  BestSupplierPricingRow,
  SupplierPriceOption,
  CostSavingsRow,
  CostSavingsSummary,
  LiveMarketPriceRow,
  LiveMarketPriceOffer,
  RegionalPriceComparisonRow,
  RegionalPriceComparisonRegion,
  HistoricalPriceTrendRow,
  HistoricalPriceTrendPoint,
  DistrictPriceIntelligenceRow,
  DistrictPriceTrendPoint,
} from "@/lib/reports-types";

export async function getMaterialConsumptionRows(builderId: string): Promise<MaterialConsumptionRow[]> {
  const items = await prisma.orderItem.findMany({
    where: { order: { userId: builderId } },
    select: {
      quantity: true,
      productId: true,
      order: { select: { createdAt: true } },
      product: {
        select: {
          name: true,
          unit: true,
          category: { select: { name: true } },
        },
      },
    },
    orderBy: { order: { createdAt: "desc" } },
  });

  const byProduct = new Map<string, MaterialConsumptionRow>();

  for (const item of items) {
    const existing = byProduct.get(item.productId);
    const createdAt = item.order.createdAt.toISOString();

    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.orderCount += 1;
      if (createdAt > existing.lastOrderedAt) existing.lastOrderedAt = createdAt;
    } else {
      byProduct.set(item.productId, {
        productId: item.productId,
        name: item.product.name,
        unit: item.product.unit,
        category: item.product.category?.name ?? "—",
        totalQuantity: item.quantity,
        orderCount: 1,
        lastOrderedAt: createdAt,
      });
    }
  }

  return Array.from(byProduct.values()).sort((a, b) => b.totalQuantity - a.totalQuantity);
}

export async function getBestSupplierPricingRows(builderId: string): Promise<BestSupplierPricingRow[]> {
  const orderedProducts = await prisma.orderItem.findMany({
    where: { order: { userId: builderId } },
    select: {
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          canonicalProductId: true,
          canonicalProduct: { select: { canonicalKey: true, title: true } },
        },
      },
    },
  });

  const canonicalById = new Map<string, { canonicalKey: string; title: string; unit: string }>();
  for (const item of orderedProducts) {
    const canonicalProduct = item.product.canonicalProduct;
    if (!canonicalProduct || !item.product.canonicalProductId) continue;
    if (!canonicalById.has(item.product.canonicalProductId)) {
      canonicalById.set(item.product.canonicalProductId, {
        canonicalKey: canonicalProduct.canonicalKey,
        title: canonicalProduct.title,
        unit: item.product.unit,
      });
    }
  }

  if (canonicalById.size === 0) return [];

  const listings = await getSupplierListings();
  const rows: BestSupplierPricingRow[] = [];

  for (const [canonicalProductId, meta] of canonicalById.entries()) {
    const matches = listings.filter(
      (listing) => listing.canonicalProductId === canonicalProductId && listing.active
    );
    if (matches.length === 0) continue;

    const rawOptions = matches.map((listing) => ({
      supplierId: listing.supplierId,
      price: parseListingPrice(listing.price),
    }));

    const cheapestPrice = Math.min(...rawOptions.map((o) => o.price));
    const withCheapestFlag: SupplierPriceOption[] = rawOptions
      .map((option) => ({ ...option, isCheapest: option.price === cheapestPrice }))
      .sort((a, b) => a.price - b.price);

    rows.push({
      canonicalKey: meta.canonicalKey,
      name: meta.title,
      unit: meta.unit,
      options: withCheapestFlag,
    });
  }

  return rows;
}

export async function getCostSavingsSummary(builderId: string): Promise<CostSavingsSummary> {
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { userId: builderId } },
    select: {
      quantity: true,
      unitPrice: true,
      productId: true,
      product: {
        select: {
          name: true,
          unit: true,
          canonicalProductId: true,
          canonicalProduct: { select: { canonicalKey: true } },
        },
      },
    },
  });

  const relevant = orderItems.filter((item) => item.product.canonicalProduct);
  if (relevant.length === 0) {
    return { totalPotentialSavings: 0, rows: [] };
  }

  const listings = await getSupplierListings();

  const cheapestByCanonicalId = new Map<string, number>();
  for (const listing of listings) {
    if (!listing.active || !listing.canonicalProductId) continue;
    const price = parseListingPrice(listing.price);
    const existing = cheapestByCanonicalId.get(listing.canonicalProductId);
    if (existing === undefined || price < existing) {
      cheapestByCanonicalId.set(listing.canonicalProductId, price);
    }
  }

  const byProduct = new Map<string, CostSavingsRow>();

  for (const item of relevant) {
    const canonicalProductId = item.product.canonicalProductId;
    if (!canonicalProductId) continue;
    const currentBestUnitPrice = cheapestByCanonicalId.get(canonicalProductId);
    if (currentBestUnitPrice === undefined) continue;

    const paidUnitPrice = Number(item.unitPrice);
    const existing = byProduct.get(item.productId);

    if (existing) {
      existing.quantityOrdered += item.quantity;
      existing.amountPaid += paidUnitPrice * item.quantity;
    } else {
      byProduct.set(item.productId, {
        productId: item.productId,
        name: item.product.name,
        unit: item.product.unit,
        quantityOrdered: item.quantity,
        amountPaid: paidUnitPrice * item.quantity,
        currentBestUnitPrice,
        potentialSavings: 0,
      });
    }
  }

  const rows = Array.from(byProduct.values())
    .map((row) => {
      const currentBestTotal = row.currentBestUnitPrice * row.quantityOrdered;
      const potentialSavings = Math.max(0, row.amountPaid - currentBestTotal);
      return { ...row, potentialSavings };
    })
    .filter((row) => row.potentialSavings > 0)
    .sort((a, b) => b.potentialSavings - a.potentialSavings);

  const totalPotentialSavings = rows.reduce((sum, row) => sum + row.potentialSavings, 0);

  return { totalPotentialSavings, rows };
}

export async function getLiveMarketPriceRows(builderId: string): Promise<LiveMarketPriceRow[]> {
  const orderedProducts = await prisma.orderItem.findMany({
    where: { order: { userId: builderId } },
    select: {
      product: {
        select: {
          id: true,
          unit: true,
          canonicalProductId: true,
          canonicalProduct: { select: { canonicalKey: true, title: true } },
        },
      },
    },
  });

  const canonicalById = new Map<string, { canonicalKey: string; title: string; unit: string }>();
  for (const item of orderedProducts) {
    const canonicalProduct = item.product.canonicalProduct;
    if (!canonicalProduct || !item.product.canonicalProductId) continue;
    if (!canonicalById.has(item.product.canonicalProductId)) {
      canonicalById.set(item.product.canonicalProductId, {
        canonicalKey: canonicalProduct.canonicalKey,
        title: canonicalProduct.title,
        unit: item.product.unit,
      });
    }
  }

  if (canonicalById.size === 0) return [];

  const listings = await getSupplierListings();

  const supplierIds = Array.from(new Set(listings.map((listing) => listing.supplierId)));
  const suppliers = supplierIds.length
    ? await prisma.supplierProfile.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, companyName: true },
      })
    : [];
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.companyName]));

  const showSupplierNames = shouldShowSupplierNames();

  const rows: LiveMarketPriceRow[] = [];

  for (const [canonicalProductId, meta] of canonicalById.entries()) {
    const matches = listings.filter(
      (listing) => listing.canonicalProductId === canonicalProductId && listing.active
    );
    if (matches.length === 0) continue;

    const allOffers = matches
      .map((listing) => ({
        supplierId: listing.supplierId,
        supplierName: supplierNameById.get(listing.supplierId) ?? listing.supplierId,
        price: parseListingPrice(listing.price),
      }))
      .sort((a, b) => a.price - b.price);

    const prices = allOffers.map((o) => o.price);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);

    const offers: LiveMarketPriceOffer[] = showSupplierNames
      ? allOffers
      : lowestPrice === highestPrice
      ? [{ label: "Only offer", price: lowestPrice }]
      : [
          { label: "Lowest", price: lowestPrice },
          { label: "Highest", price: highestPrice },
        ];

    rows.push({
      canonicalKey: meta.canonicalKey,
      name: meta.title,
      unit: meta.unit,
      offers,
      lowestPrice,
      highestPrice,
      showSupplierNames,
    });
  }

  return rows;
}

export async function getRegionalPriceComparisonRows(builderId: string): Promise<RegionalPriceComparisonRow[]> {
  const orderedProducts = await prisma.orderItem.findMany({
    where: { order: { userId: builderId } },
    select: {
      product: {
        select: {
          id: true,
          unit: true,
          canonicalProductId: true,
          canonicalProduct: { select: { id: true, canonicalKey: true, title: true } },
        },
      },
    },
  });

  const canonicalById = new Map<string, { canonicalKey: string; title: string; unit: string }>();
  for (const item of orderedProducts) {
    const canonicalProduct = item.product.canonicalProduct;
    if (!canonicalProduct) continue;
    if (!canonicalById.has(canonicalProduct.id)) {
      canonicalById.set(canonicalProduct.id, {
        canonicalKey: canonicalProduct.canonicalKey,
        title: canonicalProduct.title,
        unit: item.product.unit,
      });
    }
  }

  if (canonicalById.size === 0) return [];

  const listings = await getSupplierListings();
  const liveSupplierIds = Array.from(new Set(listings.map((l) => l.supplierId)));
  const supplierRegions = liveSupplierIds.length
    ? await prisma.supplierProfile.findMany({
        where: { id: { in: liveSupplierIds } },
        select: { id: true, region: true },
      })
    : [];
  const regionBySupplier = new Map(supplierRegions.map((s) => [s.id, s.region]));

  const rows: RegionalPriceComparisonRow[] = [];

  for (const [canonicalProductId, meta] of canonicalById.entries()) {
    const regionMap = new Map<string, number[]>();

    const snapshots = await prisma.priceSnapshot.findMany({
      where: { canonicalProductId },
      orderBy: { capturedAt: "desc" },
      take: 365,
      select: { price: true, region: true, supplierId: true },
    });

    for (const snapshot of snapshots) {
      if (!snapshot.region) continue;
      const arr = regionMap.get(snapshot.region) ?? [];
      arr.push(Number(snapshot.price));
      regionMap.set(snapshot.region, arr);
    }

    const seenLiveSuppliers = new Set<string>();
    for (const listing of listings) {
      if (listing.canonicalProductId !== canonicalProductId) continue;
      if (!listing.active) continue;
      if (seenLiveSuppliers.has(listing.supplierId)) continue;
      seenLiveSuppliers.add(listing.supplierId);

      const region = regionBySupplier.get(listing.supplierId);
      if (!region) continue;

      const arr = regionMap.get(region) ?? [];
      arr.push(parseListingPrice(listing.price));
      regionMap.set(region, arr);
    }

    if (regionMap.size === 0) continue;

    const regions: RegionalPriceComparisonRegion[] = Array.from(regionMap.entries())
      .map(([region, prices]) => ({
        region,
        averagePrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
        sampleSize: prices.length,
      }))
      .sort((a, b) => b.sampleSize - a.sampleSize);

    rows.push({
      canonicalKey: meta.canonicalKey,
      name: meta.title,
      unit: meta.unit,
      regions,
    });
  }

  return rows;
}

export async function getHistoricalPriceTrendRows(builderId: string): Promise<HistoricalPriceTrendRow[]> {
  const orderedProducts = await prisma.orderItem.findMany({
    where: { order: { userId: builderId } },
    select: {
      product: {
        select: {
          id: true,
          unit: true,
          canonicalProductId: true,
          canonicalProduct: { select: { id: true, canonicalKey: true, title: true } },
        },
      },
    },
  });

  const canonicalById = new Map<string, { canonicalKey: string; title: string; unit: string }>();
  for (const item of orderedProducts) {
    const canonicalProduct = item.product.canonicalProduct;
    if (!canonicalProduct) continue;
    if (!canonicalById.has(canonicalProduct.id)) {
      canonicalById.set(canonicalProduct.id, {
        canonicalKey: canonicalProduct.canonicalKey,
        title: canonicalProduct.title,
        unit: item.product.unit,
      });
    }
  }

  if (canonicalById.size === 0) return [];

  const rows: HistoricalPriceTrendRow[] = [];

  for (const [canonicalProductId, meta] of canonicalById.entries()) {
    const snapshots = await prisma.priceSnapshot.findMany({
      where: { canonicalProductId },
      orderBy: { capturedAt: "desc" },
      take: 365,
      select: { price: true, capturedAt: true },
    });

    if (snapshots.length === 0) continue;

    const periodMap = new Map<string, number[]>();
    for (const snapshot of snapshots) {
      const period = snapshot.capturedAt.toISOString().slice(0, 7);
      const arr = periodMap.get(period) ?? [];
      arr.push(Number(snapshot.price));
      periodMap.set(period, arr);
    }

    const points: HistoricalPriceTrendPoint[] = Array.from(periodMap.entries())
      .map(([period, prices]) => ({
        period,
        averagePrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
        sampleSize: prices.length,
      }))
      .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

    rows.push({
      canonicalKey: meta.canonicalKey,
      name: meta.title,
      unit: meta.unit,
      points,
    });
  }

  return rows;
}

export async function getDistrictPriceIntelligenceRows(builderId: string): Promise<DistrictPriceIntelligenceRow[]> {
  const sites = await prisma.site.findMany({
    where: { builderId },
    select: { city: true },
  });
  const siteCities = Array.from(
    new Set(sites.map((s) => s.city).filter((c): c is string => Boolean(c && c.trim())))
  );

  let districts = siteCities.length
    ? await prisma.pricingDistrict.findMany({
        where: { name: { in: siteCities, mode: "insensitive" } },
      })
    : [];

  if (districts.length === 0) {
    const districtIds = await prisma.pricingDistrictPriceDaily.findMany({
      where: { geographyLevel: "DISTRICT", publicDisplayAllowed: true },
      distinct: ["districtId"],
      select: { districtId: true },
      take: 10,
    });
    const nonNullDistrictIds = districtIds.map((d) => d.districtId).filter((id): id is string => id !== null);
    districts = nonNullDistrictIds.length
      ? await prisma.pricingDistrict.findMany({
          where: { id: { in: nonNullDistrictIds } },
        })
      : [];
  }

  if (districts.length === 0) return [];

  const districtIds = districts.map((d) => d.id);
  const districtById = new Map(districts.map((d) => [d.id, d]));

  const latestDaily = await prisma.pricingDistrictPriceDaily.findMany({
    where: { geographyLevel: "DISTRICT", districtId: { in: districtIds }, publicDisplayAllowed: true },
    orderBy: { priceDate: "desc" },
    take: 500,
    include: {
      canonicalSku: {
        select: { id: true, code: true, materialCategory: { select: { name: true } } },
      },
    },
  });

  const latestByKey = new Map<string, (typeof latestDaily)[number]>();
  for (const row of latestDaily) {
    const key = `${row.canonicalSkuId}:${row.districtId}`;
    if (!latestByKey.has(key)) {
      latestByKey.set(key, row);
    }
  }

  const rows: DistrictPriceIntelligenceRow[] = [];
  for (const row of latestByKey.values()) {
    if (!row.districtId) continue;
    const district = districtById.get(row.districtId);
    if (!district) continue;

    const trendRows = await prisma.pricingTrendMonthly.findMany({
      where: { canonicalSkuId: row.canonicalSkuId, geographyLevel: "DISTRICT", districtId: row.districtId },
      orderBy: { monthStart: "desc" },
      take: 6,
    });

    const trend: DistrictPriceTrendPoint[] = trendRows.map((t) => ({
      monthStart: t.monthStart.toISOString().slice(0, 10),
      medianPerBaseUnit: Number(t.medianPerBaseUnit),
      momChangePct: t.momChangePct !== null ? Number(t.momChangePct) : null,
      yoyChangePct: t.yoyChangePct !== null ? Number(t.yoyChangePct) : null,
      confidence: t.confidence,
    }));

    rows.push({
      canonicalSkuCode: row.canonicalSku.code,
      materialName: row.canonicalSku.materialCategory?.name ?? row.canonicalSku.code,
      districtCode: district.code,
      districtName: district.name,
      baseUnit: row.baseUnit,
      latestPriceDate: row.priceDate.toISOString().slice(0, 10),
      medianPerBaseUnit: Number(row.medianPerBaseUnit),
      minPerBaseUnit: row.minPerBaseUnit !== null ? Number(row.minPerBaseUnit) : null,
      maxPerBaseUnit: row.maxPerBaseUnit !== null ? Number(row.maxPerBaseUnit) : null,
      medianPerDisplayUnit: row.medianPerDisplayUnit !== null ? Number(row.medianPerDisplayUnit) : null,
      displayUnit: row.displayUnit ?? null,
      confidence: row.confidence,
      method: row.method,
      trend,
    });
  }

  rows.sort((a, b) => a.materialName.localeCompare(b.materialName) || a.districtName.localeCompare(b.districtName));

  return rows;
}
