import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { forceRefreshMarketInsight } from "@/lib/market-insight";

export const dynamic = "force-dynamic";

// POST /api/builder/products/[canonicalProductId]/report/market-insight
// Manual "Refresh" button for module 6 (live market intelligence).
// Rate-limited to once per 10 minutes (enforced inside
// forceRefreshMarketInsight via MarketInsightCache.generatedAt) — this is
// deliberately the ONLY way a live LLM+web-search call can be triggered;
// GET /report always reads through the passive 12h-TTL cache path and
// never calls the live API on its own.
export async function POST(request: Request, { params }: { params: { canonicalProductId: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const { canonicalProductId } = params;
    const canonicalProduct = await prisma.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
      select: { category: { select: { name: true } } },
    });
    if (!canonicalProduct) {
      return NextResponse.json({ error: "Canonical product not found" }, { status: 404 });
    }

    const builderSite = await prisma.site.findFirst({
      where: { builderId: user.id, status: "ACTIVE" },
      select: { state: true },
      orderBy: { createdAt: "asc" },
    });
    const region = builderSite?.state || "India";
    const category = canonicalProduct.category?.name || "Construction material";

    const result = await forceRefreshMarketInsight(category, region);

    if (result.rateLimited) {
      return NextResponse.json(
        {
          error: "Please wait before refreshing again",
          retryAfterMs: result.retryAfterMs,
          marketInsight: result.insight,
        },
        { status: 429 }
      );
    }

    return NextResponse.json({ marketInsight: result.insight });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Market insight refresh POST error:", error);
    return NextResponse.json({ error: "Failed to refresh market insight" }, { status: 500 });
  }
}
