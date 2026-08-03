import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { computeForecast, computeSignal, estimateLandedCost, type HistoryPoint } from "@/lib/price-forecast";
import { getOrRefreshMarketInsight } from "@/lib/market-insight";

export const dynamic = "force-dynamic";

// Builder "price report" aggregated read endpoint (§1-§6 of the price-report
// feature). Builder-only, direct-Prisma, mirroring the existing
// price-comparison/[canonicalProductId] route pattern. Bundles everything
// the report page needs in one round trip:
//   - signal: Buy/Hold/Wait verdict
//   - history: raw PriceSnapshot rows (capped, newest first)
//   - forecast: transparent statistical projection + confidence band
//   - bestPrice: all active suppliers ranked by landed cost
//   - regional: this builder's region vs up to 2 other regions with data
//   - marketInsight: cached (never live-per-view) LLM market summary
//
// Does NOT touch the public listings read path (apps/supplier's
// /api/public/listings) — reads directly from Prisma exactly like
// price-comparison/[canonicalProductId]/route.ts.
export async function GET(request: Request, { params }: { params: { canonicalProductId: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const { canonicalProductId } = params;
    if (!canonicalProductId) {
      return NextResponse.json({ error: "canonicalProductId is required" }, { status: 400 });
    }

    const canonicalProduct = await prisma.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
      select: { id: true, title: true, category: { select: { name: true } } },
    });
    if (!canonicalProduct) {
      return NextResponse.json({ error: "Canonical product not found" }, { status: 404 });
    }

    // Builder's own region — derived from their first active Site.state,
    // per the audit decision to reuse Site.state as the region key rather
    // than introduce a new Region model.
    const builderSite = await prisma.site.findFirst({
      where: { builderId: user.id, status: "ACTIVE" },
      select: { state: true },
      orderBy: { createdAt: "asc" },
    });
    const builderRegion = builderSite?.state || null;

    const [offers, historyRows] = await Promise.all([
      prisma.product.findMany({
        where: { canonicalProductId, isActive: true },
        select: {
          id: true,
          name: true,
          brand: true,
          basePrice: true,
          unit: true,
          stock: true,
          maxServiceableQty: true,
          supplierId: true,
          supplier: { select: { companyName: true } },
          brandRef: { select: { name: true } },
          pricingTiers: {
            select: { minQty: true, maxQty: true, tierPrice: true },
            orderBy: { minQty: "asc" },
          },
        },
        orderBy: { basePrice: "asc" },
      }),
      // 365-day cap: enough for the "All" range toggle + a full year of
      // regional/forecast context without unbounded growth.
      prisma.priceSnapshot.findMany({
        where: { canonicalProductId },
        orderBy: { capturedAt: "desc" },
        take: 365,
        select: { id: true, price: true, source: true, unit: true, region: true, capturedAt: true, supplierId: true },
      }),
    ]);

    // ── Module 1 & 3: signal + forecast ──────────────────────────────
    const historyPoints: HistoryPoint[] = historyRows.map((r) => ({ price: Number(r.price), capturedAt: r.capturedAt }));
    const forecast = computeForecast(historyPoints, 30);
    const signal = computeSignal(historyPoints, forecast);

    // ── Module 4: best price finder (landed cost) ────────────────────
    const bestPrice = offers
      .map((offer) => {
        const breakdown = estimateLandedCost(Number(offer.basePrice), 1);
        return {
          productId: offer.id,
          supplierId: offer.supplierId,
          supplierName: offer.supplier.companyName,
          brand: offer.brandRef?.name ?? offer.brand ?? null,
          unit: offer.unit,
          basePrice: Number(offer.basePrice),
          stock: offer.stock,
          maxServiceableQty: offer.maxServiceableQty,
          landedCost: breakdown,
        };
      })
      .sort((a, b) => a.landedCost.landedCost - b.landedCost.landedCost);

    // ── Module 5: regional price variation ───────────────────────────
    // Groups snapshot rows by region (free-text, e.g. Site.state); "not
    // enough data" whenever fewer than 2 regions have at least 1 snapshot.
    const regionMap = new Map<string, number[]>();
    for (const row of historyRows) {
      if (!row.region) continue;
      const arr = regionMap.get(row.region) ?? [];
      arr.push(Number(row.price));
      regionMap.set(row.region, arr);
    }
    const regionalAverages = Array.from(regionMap.entries()).map(([region, prices]) => ({
      region,
      averagePrice: prices.reduce((s, p) => s + p, 0) / prices.length,
      sampleSize: prices.length,
    }));
    const regional = {
      builderRegion,
      hasEnoughData: regionalAverages.length >= 2,
      regions: regionalAverages.sort((a, b) => b.sampleSize - a.sampleSize).slice(0, 4),
    };

    // ── Module 6: market intelligence (12h TTL cache; never live per view) ──
    const categoryName = canonicalProduct.category?.name || "Construction material";
    const insightRegion = builderRegion || "India";
    const marketInsight = await getOrRefreshMarketInsight(categoryName, insightRegion);

    return NextResponse.json({
      canonicalProductId,
      title: canonicalProduct.title,
      category: categoryName,
      signal,
      forecast,
      history: historyRows.map((snapshot) => ({
        id: snapshot.id,
        price: Number(snapshot.price),
        source: snapshot.source,
        unit: snapshot.unit,
        region: snapshot.region,
        recordedAt: snapshot.capturedAt,
        supplierId: snapshot.supplierId,
      })),
      bestPrice,
      regional,
      marketInsight,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Price report GET error:", error);
    return NextResponse.json({ error: "Failed to fetch price report" }, { status: 500 });
  }
}
