import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

import { getWatchlistPriceIntelligence } from "@/lib/watchlist-pricing";

export async function DELETE(request: Request, { params }: { params: { productId: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    await prisma.watchlist.deleteMany({
      where: { userId: user.id, productId: params.productId },
    });

    return NextResponse.json({ productId: params.productId, removed: true });
  } catch (error) {
    console.error("Watchlist DELETE error:", error);
    return NextResponse.json({ error: "Failed to remove from watchlist" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { productId: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const targetPriceRaw = body?.targetPrice;
    if (targetPriceRaw === undefined || targetPriceRaw === null || targetPriceRaw === "") {
      return NextResponse.json({ error: "Target price is required" }, { status: 400 });
    }

    const targetPrice = Number(targetPriceRaw);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      return NextResponse.json({ error: "Target price must be a numeric value greater than zero" }, { status: 400 });
    }

    const existing = await prisma.watchlist.findUnique({
      where: { userId_productId: { userId: user.id, productId: params.productId } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Watchlist item not found" }, { status: 404 });
    }

    const item = await prisma.watchlist.update({
      where: { id: existing.id },
      data: { targetPrice },
      include: { product: true },
    });

    let priceIntel = null;
    try {
      priceIntel = await getWatchlistPriceIntelligence(item.productId, user.id, targetPrice);
    } catch (err) {
      console.error("Watchlist price intelligence enrichment failed on update:", err);
    }

    return NextResponse.json({
      id: item.id,
      productId: item.productId,
      name: item.product.name,
      unit: item.product.unit,
      basePrice: Number(item.product.basePrice),
      targetPrice: Number(item.targetPrice),
      alertSent: item.alertSent,
      priceIntelligence: priceIntel,
    });
  } catch (error) {
    console.error("Watchlist PATCH error:", error);
    return NextResponse.json({ error: "Failed to update target price" }, { status: 500 });
  }
}

