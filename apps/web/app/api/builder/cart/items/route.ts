import { NextResponse } from "next/server";
import {
  prisma,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json();
    const { productId, quantity } = body;

    if (!productId || !quantity) {
      return NextResponse.json(
        { error: "productId and quantity are required" },
        { status: 400 }
      );
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || !product.isActive) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const item = await prisma.cartItem.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      update: { quantity },
      create: { userId: user.id, productId, quantity },
    });

    return NextResponse.json({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
    });
  } catch (error) {
    console.error("Cart items POST error:", error);
    return NextResponse.json(
      { error: "Failed to update cart" },
      { status: 500 }
    );
  }
}
