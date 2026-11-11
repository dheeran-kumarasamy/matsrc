import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

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
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.watchlist.findMany({
      where: {
        userId: user.id,
      },
      select: {
        productId: true,
      },
    });

    return NextResponse.json(items.map((item) => item.productId));
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Watchlist IDs GET error:", error);
    return NextResponse.json({ error: "Failed to fetch watchlist IDs" }, { status: 500 });
  }
}
