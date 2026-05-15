import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, PaymentMethod } from "@matsrc/db";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  formatDate,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      include: { items: { include: { product: { include: { supplier: true } } } } },
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

    const cartItems = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          include: {
            supplier: true,
            pricingTiers: { orderBy: { minQty: "asc" } },
          },
        },
      },
    });

    if (!cartItems.length) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Group by supplier
    const groups = new Map<
      string,
      { supplierId: string; supplierName: string; items: Array<{ productId: string; quantity: number; unitPrice: number }> }
    >();

    for (const item of cartItems) {
      const unitPrice = resolveUnitPrice(item.product, item.quantity);
      const group = groups.get(item.product.supplierId) ?? {
        supplierId: item.product.supplierId,
        supplierName: item.product.supplier.companyName,
        items: [],
      };
      group.items.push({ productId: item.productId, quantity: item.quantity, unitPrice });
      groups.set(item.product.supplierId, group);
    }

    const createdOrders = [];

    for (const group of groups.values()) {
      const totalAmount = group.items.reduce(
        (acc, item) => acc + item.unitPrice * item.quantity,
        0
      );
      const deliveryDate = body.deliveryDate ? new Date(body.deliveryDate) : null;

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          status: OrderStatus.PLACED,
          paymentStatus: PaymentStatus.PENDING,
          totalAmount,
          deliveryDate,
          items: {
            create: group.items.map((item) => ({
              productId: item.productId,
              supplierId: group.supplierId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              deliveryDate,
            })),
          },
          tracking: {
            create: {
              status: OrderStatus.PLACED,
              note: "Pending supplier confirmation",
            },
          },
        },
      });

      createdOrders.push({
        id: order.id,
        supplierName: group.supplierName,
        total: totalAmount,
        itemCount: group.items.length,
        status: order.status,
      });
    }

    // Clear cart
    await prisma.cartItem.deleteMany({ where: { userId: user.id } });

    return NextResponse.json({ orders: createdOrders }, { status: 201 });
  } catch (error) {
    console.error("Orders POST error:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
