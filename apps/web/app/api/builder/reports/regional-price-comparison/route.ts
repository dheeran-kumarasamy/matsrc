import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import type { RegionalPriceComparisonRow, RegionalPriceComparisonRegion } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// Regional Price Comparison: for canonical products the builder has ordered
// before, compares average prices for that same material across regions,
// sourced from the PriceSnapshot append-only price time series (grouped by
// region — same regional-averaging pattern used by the single-product price
// report endpoint). Uses CanonicalProduct.id (not canonicalKey) since
// PriceSnapshot.canonicalProductId is the real FK.
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

    const rows: RegionalPriceComparisonRow[] = [];

    for (const [canonicalProductId, meta] of canonicalById.entries()) {
      const snapshots = await prisma.priceSnapshot.findMany({
        where: { canonicalProductId },
        orderBy: { capturedAt: "desc" },
        take: 365,
        select: { price: true, region: true },
      });

      const regionMap = new Map<string, number[]>();
      for (const snapshot of snapshots) {
        if (!snapshot.region) continue;
        const arr = regionMap.get(snapshot.region) ?? [];
        arr.push(Number(snapshot.price));
        regionMap.set(snapshot.region, arr);
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
