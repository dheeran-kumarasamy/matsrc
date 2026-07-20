import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// UF-09: Watchlist & Price Alerts — FR-07, FR-31
// Local Next.js route handler (direct-Prisma), mirroring the existing
// pattern used by cart/orders/purchase-orders in this app rather than
// proxying to the separate NestJS apps/api watchlist controller.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.watchlist.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        unit: item.product.unit,
        basePrice: Number(item.product.basePrice),
        targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
      }))
    );
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
