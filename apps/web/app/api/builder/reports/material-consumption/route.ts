import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import type { MaterialConsumptionRow } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// Material Consumption Report: aggregates the builder's own OrderItem history
// by product — total quantity ordered, number of orders it appeared in, and
// the most recent order date. Real, queryable data (Order/OrderItem tables),
// no dependency on any external/live service.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.orderItem.findMany({
      where: { order: { userId: user.id } },
      select: {
        quantity: true,
        productId: true,
        order: { select: { createdAt: true } },
        product: {
          select: {
            name: true,
            unit: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { order: { createdAt: "desc" } },
    });

    const byProduct = new Map<string, MaterialConsumptionRow>();

    for (const item of items) {
      const existing = byProduct.get(item.productId);
      const createdAt = item.order.createdAt.toISOString();

      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.orderCount += 1;
        if (createdAt > existing.lastOrderedAt) existing.lastOrderedAt = createdAt;
      } else {
        byProduct.set(item.productId, {
          productId: item.productId,
          name: item.product.name,
          unit: item.product.unit,
          category: item.product.category?.name ?? "—",
          totalQuantity: item.quantity,
          orderCount: 1,
          lastOrderedAt: createdAt,
        });
      }
    }

    const rows = Array.from(byProduct.values()).sort(
      (a, b) => b.totalQuantity - a.totalQuantity
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Material consumption report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
