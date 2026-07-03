import { NextResponse } from "next/server";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            name: true,
            unit: true,
            supplierId: true,
            basePrice: true,
            supplier: { select: { companyName: true } },
            pricingTiers: {
              select: { minQty: true, maxQty: true, tierPrice: true },
              orderBy: { minQty: "asc" },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const subtotal = items.reduce(
      (acc, item) =>
        acc + resolveUnitPrice(item.product, item.quantity) * item.quantity,
      0
    );

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        unit: item.product.unit,
        supplierId: item.product.supplierId,
        supplierName: item.product.supplier.companyName,
        quantity: item.quantity,
        unitPrice: resolveUnitPrice(item.product, item.quantity),
        lineTotal: resolveUnitPrice(item.product, item.quantity) * item.quantity,
      })),
      summary: {
        itemCount: items.length,
        subtotal,
        subtotalLabel: formatCurrency(subtotal),
      },
    });
  } catch (error) {
    console.error("Cart items GET error:", error);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const productId = typeof body.productId === "string" ? body.productId : "";
    const quantity = Number(body.quantity);

    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "Valid productId and quantity are required" },
        { status: 400 }
      );
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true },
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
