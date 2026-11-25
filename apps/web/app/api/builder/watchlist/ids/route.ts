import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx, resolveUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

/**
 * Lightweight Watchlist IDs endpoint.
 *
 * Dedicated endpoint for WatchlistProvider and other client surfaces that only
 * require the set of watched product IDs (e.g. for heart/bookmark toggle icons).
 * Avoids the expensive price-intelligence resolution, daily district median lookups,
 * and pricing alert evaluation history performed by the full /api/builder/watchlist route.
 */
export async function GET(request: Request) {
  try {
    let ctx: any = null;
    try {
      ctx = await resolveUserCtx(request);
    } catch {
      ctx = getUserCtx(request);
    }

    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    let items: Array<{ productId: string }> = [];
    try {
      items = await prisma.watchlist.findMany({
        where: {
          userId: user.id,
        },
        select: {
          productId: true,
        },
      });
    } catch (dbErr: any) {
      console.warn("Watchlist IDs query fallback:", dbErr?.message);
    }

    return NextResponse.json(items.map((item) => item.productId));
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED" || error?.message?.includes("UNAUTHENTICATED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Watchlist IDs GET error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch watchlist IDs",
        message: error?.message || "Failed to fetch watchlist IDs",
        code: error?.code,
      },
      { status: 500 }
    );
  }
}
