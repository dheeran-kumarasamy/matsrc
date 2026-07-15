import { NextResponse } from "next/server";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export const dynamic = "force-dynamic";

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
            aggregationEnabled: true,
            aggregationPriceTiers: true,
            aggregationWindowDays: true,
          },
        },

      },
      orderBy: { updatedAt: "desc" },
    });

    const subtotal = items.reduce((acc, item) => {
      const unitPrice =
        item.resolvedUnitPrice != null
          ? Number(item.resolvedUnitPrice)
          : resolveUnitPrice(item.product, item.quantity);
      return acc + unitPrice * item.quantity;
    }, 0);

    return NextResponse.json({
      items: items.map((item) => {
        const unitPrice =
          item.resolvedUnitPrice != null
            ? Number(item.resolvedUnitPrice)
            : resolveUnitPrice(item.product, item.quantity);

        return {
          id: item.id,
          productId: item.productId,
          name: item.product.name,
          unit: item.product.unit,
          supplierId: item.resolvedSupplierId ?? item.product.supplierId,
          supplierName: item.product.supplier.companyName,
          quantity: item.quantity,
          unitPrice,
          lineTotal: unitPrice * item.quantity,
          aggregationEnabled: item.product.aggregationEnabled,
          aggregationPriceTiers: item.product.aggregationPriceTiers,
          aggregationWindowDays: item.product.aggregationWindowDays,
        };
      }),

      summary: {
        itemCount: items.length,
        subtotal,
        subtotalLabel: formatCurrency(subtotal),
      },
    });
  } catch (error) {
    console.error("Cart GET error:", error);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}
