import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getWatchlistPriceIntelligence } from "@/lib/watchlist-pricing";
import { suppressionReasonLabel } from "@/lib/watchlist-alert-copy";

export const dynamic = "force-dynamic";

// UF-09: Watchlist & Price Alerts — FR-07, FR-31
// Local Next.js route handler (direct-Prisma), mirroring the existing
// pattern used by cart/orders/purchase-orders in this app rather than
// proxying to the separate NestJS apps/api watchlist controller.
//
// Phase 6D: additive Price Intelligence enrichment — current market price,
// gap-to-target, confidence/method, and recent alert-evaluation history
// (with customer-friendly suppression copy). Sourced from the same
// read-only serving layer (PricingDistrictPriceDaily /
// PricingAlertEvaluation) used by the backend alert engine and the
// district-pricing panel. No schema changes, no writes beyond the
// existing Watchlist upsert/delete.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.watchlist.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });

    const enriched = await Promise.all(
      items.map(async (item) => {
        const targetPrice = item.targetPrice ? Number(item.targetPrice) : null;

        let priceIntel = null;
        try {
          priceIntel = await getWatchlistPriceIntelligence(item.productId, user.id, targetPrice);
        } catch (err) {
          console.error("Watchlist price intelligence enrichment failed:", err);
        }

        let recentEvaluations: Array<{
          evaluatedAt: string;
          didTrigger: boolean;
          suppressedReason: string | null;
          suppressedReasonLabel: string | null;
        }> = [];
        try {
          const evaluations = await prisma.pricingAlertEvaluation.findMany({
            where: { watchlistId: item.id },
            orderBy: { evaluatedAt: "desc" },
            take: 5,
            select: { evaluatedAt: true, didTrigger: true, suppressedReason: true },
          });
          recentEvaluations = evaluations.map((e) => ({
            evaluatedAt: e.evaluatedAt.toISOString(),
            didTrigger: e.didTrigger,
            suppressedReason: e.suppressedReason,
            suppressedReasonLabel: suppressionReasonLabel(e.suppressedReason),
          }));
        } catch (err) {
          console.error("Watchlist alert history fetch failed:", err);
        }

        return {
          id: item.id,
          productId: item.productId,
          name: item.product.name,
          unit: item.product.unit,
          basePrice: Number(item.product.basePrice),
          targetPrice,
          alertSent: item.alertSent,
          priceIntelligence: priceIntel,
          recentEvaluations,
        };
      })
    );

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Watchlist GET error:", error);
    return NextResponse.json({ error: "Failed to fetch watchlist" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json();

    const productId: string | undefined = body?.productId;
    const targetPriceRaw: string | undefined = body?.targetPrice;

    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const targetPrice = targetPriceRaw ? Number(targetPriceRaw) : null;

    const item = await prisma.watchlist.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      update: { targetPrice },
      create: {
        userId: user.id,
        productId,
        targetPrice,
      },
    });

    return NextResponse.json({ id: item.id, productId: item.productId });
  } catch (error) {
    console.error("Watchlist POST error:", error);
    return NextResponse.json({ error: "Failed to add to watchlist" }, { status: 500 });
  }
}
