import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, OrderStatus, notifyCustomerOrderStatusChanged } from "@matsrc/db";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string } | undefined;
  if (!user?.email || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return null;
  }
  return user;
}

// POST /api/admin/orders/[orderId]/confirm-delivery
//
// Admin override to mark an order as DELIVERED when the buyer/site engineer
// verified receipt offline (e.g. via phone, WhatsApp, or signed Delivery Challan).
export async function POST(request: Request, { params }: { params: { orderId: string } }) {
  const user = await requireAdmin();
  if (!user?.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        selectedSupplier: { select: { id: true, userId: true, companyName: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.status !== OrderStatus.DISPATCHED) {
      return NextResponse.json(
        { error: `Cannot mark delivered: order is currently ${order.status}. Delivery confirmation is only valid for DISPATCHED orders.` },
        { status: 400 }
      );
    }

    const note = `Admin (${user.name || user.email}) marked order as DELIVERED on behalf of buyer (Admin override)`;

    const updated = await prisma.$transaction(async (tx) => {
      const delivered = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.DELIVERED,
          deliveryDate: new Date(),
        },
        select: { id: true, status: true, orderNumber: true, enquiryId: true },
      });

      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.DELIVERED,
          note,
        },
      });

      return delivered;
    });

    // Notify buyer via customer order status pipeline
    try {
      await notifyCustomerOrderStatusChanged(prisma as any, {
        orderId: order.id,
        previousStatus: OrderStatus.DISPATCHED,
        newStatus: OrderStatus.DELIVERED,
      });
    } catch (err) {
      console.error(`Failed to dispatch customer_order_status notification for order ${order.id}:`, err);
    }

    // In-app notification to the supplier
    if (order.selectedSupplier?.userId) {
      try {
        const orderRef = order.orderNumber || order.enquiryId || order.id.slice(0, 8);
        await prisma.notification.create({
          data: {
            userId: order.selectedSupplier.userId,
            audience: "supplier",
            channel: "IN_APP",
            title: `Delivery Confirmed: ${orderRef}`,
            body: `Admin confirmed delivery for Order ${orderRef} on behalf of buyer`,
            status: "delivered",
            read: false,
            variables: JSON.stringify({
              orderId: order.id,
              status: OrderStatus.DELIVERED,
            }),
          },
        });
      } catch (err) {
        console.error(`Failed to send supplier delivery notification for order ${order.id}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      id: updated.id,
      status: updated.status,
      note,
    });
  } catch (error) {
    console.error("Admin confirm delivery POST error:", error);
    return NextResponse.json({ error: "Failed to confirm delivery" }, { status: 500 });
  }
}

