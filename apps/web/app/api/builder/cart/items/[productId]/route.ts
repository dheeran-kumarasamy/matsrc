import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: { productId: string } }
) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const url = new URL(request.url);
    const cartItemId = url.searchParams.get("cartItemId");

    const runInTx =
      typeof prisma.$transaction === "function"
        ? (fn: (tx: any) => Promise<any>) =>
            prisma.$transaction(fn, { maxWait: 10000, timeout: 20000 })
        : (fn: (tx: any) => Promise<any>) => fn(prisma);

    await runInTx(async (tx: any) => {
      // Transaction-scoped advisory lock coordinates with add, set, and checkout mutations
      if (typeof tx.$executeRaw === "function") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}), hashtext(${params.productId}))`;
      } else if (typeof tx.$queryRaw === "function") {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}), hashtext(${params.productId}))::text`;
      }

      if (cartItemId) {
        // Targeted deletion by cart item ID: never accidentally deletes a newly created row
        await tx.cartItem.deleteMany({
          where: { userId: user.id, id: cartItemId },
        });
      } else {
        await tx.cartItem.deleteMany({
          where: { userId: user.id, productId: params.productId },
        });
      }
    });

    return NextResponse.json({ productId: params.productId, removed: true });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Cart item DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove cart item" },
      { status: 500 }
    );
  }
}
