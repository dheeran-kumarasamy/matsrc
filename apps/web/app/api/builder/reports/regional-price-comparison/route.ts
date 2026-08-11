import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getSupplierListings, parseListingPrice } from "@/lib/listings";
import type { RegionalPriceComparisonRow, RegionalPriceComparisonRegion } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// Regional Price Comparison: for canonical products the builder has ordered
// before, compares average prices for that same material across regions.
//
// Data sources (merged, deduplicated by supplierId per canonical product):
//
// 1. PriceSnapshot time-series (primary) — append-only rows written each time
//    a supplier creates or reprices a listing. Rows carry PriceSnapshot.region
//    which is copied from SupplierProfile.region at write time. Historically
//    this field was NULL for all existing rows because SupplierProfile.region
//    had no UI entry point until now, so the snapshot source alone returned
//    empty results.
//
// 2. Live listings feed (fallback / supplement) — the same public feed used
//    by the Live Market Prices report. For each active listing we resolve the
//    supplier's current region from SupplierProfile.region. This means the
//    report shows data as soon as suppliers fill in their region in their
//    profile, without waiting for a new price event to be recorded.
//
// Both sources are merged into one regionMap per canonical product. The live
// feed contributes at most one price point per supplier (current basePrice),
// while PriceSnapshots contribute every historical price event (up to 365).
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const orderedProducts = await prisma.orderItem.findMany({
      where: { order: { userId: user.id } },
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

    if (canonicalById.size === 0) {
      return NextResponse.json([]);
    }

    // ── Source 2: live listings feed ─────────────────────────────────────────
    // Fetch once outside the per-product loop, then resolve supplier regions
    // in a single batch Prisma query.
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

      // ── Source 1: PriceSnapshot time-series ──────────────────────────────
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

      // ── Source 2: live listings feed (supplement) ─────────────────────────
      // For each active listing matching this canonical product, use the
      // supplier's current SupplierProfile.region. We track which suppliers
      // we've already added from this source to avoid counting the same
      // supplier twice (they may have multiple active listings for the same
      // canonical product).
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

    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Regional price comparison report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
