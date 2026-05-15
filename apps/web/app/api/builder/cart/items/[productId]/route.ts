import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export async function DELETE(
  request: Request,
  { params }: { params: { productId: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    await prisma.cartItem.deleteMany({
      where: { userId: user.id, productId: params.productId },
    });

    return NextResponse.json({ productId: params.productId, removed: true });
  } catch (error) {
    console.error("Cart item DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove cart item" },
      { status: 500 }
    );
  }
}
