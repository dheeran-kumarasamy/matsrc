import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus } from "@matsrc/db";
import {
  prisma,
  formatCurrency,
  formatDate,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      include: {
        items: {
          include: {
            product: {
              select: {
                name: true,
                unit: true,
                supplier: { select: { companyName: true } },
              },
            },
          },
        },
        tracking: { orderBy: { recordedAt: "asc" } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: order.id,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentLinkAvailable:
        order.status === OrderStatus.PROCESSING &&
        order.paymentStatus === PaymentStatus.PENDING,
      paymentLink: `/orders/${order.id}/payment`,
      total: Number(order.totalAmount),
      totalLabel: formatCurrency(order.totalAmount),
      deliveryDate: formatDate(order.deliveryDate),
      supplierName: order.items[0]?.product.supplier.companyName ?? "Supplier",
      items: order.items.map((item) => ({
        id: item.id,
        name: item.product.name,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice: Number(item.unitPrice),
      })),
      tracking: order.tracking.map((step) => ({
        id: step.id,
        status: step.status,
        label: step.note || step.status,
        recordedAt: step.recordedAt,
      })),
    });
  } catch (error) {
    console.error("Order GET error:", error);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}
