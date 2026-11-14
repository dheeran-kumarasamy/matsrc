import { NextResponse } from "next/server";
import {
  getOrCreateBuilder,
  resolveUserCtx,
} from "@/lib/builder-db";
import { getCartForUser } from "@/lib/cart-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const cart = await getCartForUser(user.id);

    return NextResponse.json(cart);
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Cart GET error:", error);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}
