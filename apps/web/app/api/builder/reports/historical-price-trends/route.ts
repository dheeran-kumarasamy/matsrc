import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import type { HistoricalPriceTrendRow, HistoricalPriceTrendPoint } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// Historical Price Trends: for canonical products the builder has ordered
// before, shows average price movement over time (by month), sourced from
// the PriceSnapshot append-only price time series. Uses CanonicalProduct.id
// (not canonicalKey) since PriceSnapshot.canonicalProductId is the real FK.
// Note: this replaces the legacy/dead `PricePoint` model (never written to
// anywhere in the codebase) which was the original reason this report was
// gated unavailable.
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
        const period = snapshot.capturedAt.toISOString().slice(0, 7); // YYYY-MM
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

    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Historical price trends report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
