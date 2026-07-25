import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus } from "@matsrc/db";
import {
  prisma,
  formatCurrency,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";
import { createOrdersFromCart } from "@/lib/order-checkout";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        createdAt: true,
        isAggregated: true,
        aggregationPoolId: true,
        items: {

          select: {
            id: true,
            product: {
              select: {
                supplier: { select: { companyName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      orders.map((order) => ({
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        itemCount: order.items.length,
        total: Number(order.totalAmount),
        totalLabel: formatCurrency(order.totalAmount),
        createdAt: order.createdAt,
        isAggregated: order.isAggregated,
        aggregationPoolId: order.aggregationPoolId,
        supplierName: order.items[0]?.product.supplier.companyName ?? "Supplier",

        paymentLinkAvailable:
          order.status === OrderStatus.PROCESSING &&
          order.paymentStatus === PaymentStatus.PENDING,
        paymentLink: `/orders/${order.id}/payment`,
      }))
    );
  } catch (error) {
    console.error("Orders GET error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    // Cart -> grouped-by-supplier Order creation (UF-03 shared pipeline).
    // Also reused by the Quick Material Request nearest-match flow — see
    // apps/web/app/api/builder/quick-request/route.ts.
    const result = await createOrdersFromCart(user.id, {
      deliveryDate: body.deliveryDate,
      deliveryLat: typeof body.deliveryLat === "number" ? body.deliveryLat : null,
      deliveryLng: typeof body.deliveryLng === "number" ? body.deliveryLng : null,
      deliveryAddress: typeof body.deliveryAddress === "string" ? body.deliveryAddress : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ orders: result.orders }, { status: 201 });
  } catch (error) {
    console.error("Orders POST error:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
