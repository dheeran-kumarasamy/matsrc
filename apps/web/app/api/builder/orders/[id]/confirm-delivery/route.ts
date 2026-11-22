import { NextResponse } from "next/server";
import { OrderStatus, notifyCustomerOrderStatusChanged } from "@matsrc/db";
import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// POST /api/builder/orders/[id]/confirm-delivery
//
// Buyer confirms receipt and physical verification of materials delivered to the site.
// Per business rules:
// - Only the buyer (contractor/client) can confirm delivery receipt.
// - Delivery can only be confirmed when the order is in DISPATCHED status.
// - Records full verification details (receiver name, delivery date, notes) into OrderTracking.
// - Transitions Order.status to DELIVERED.
// - Triggers order status notifications for buyer and supplier.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const body = await request.json().catch(() => ({}));
    const receivedDate =
      typeof body?.receivedDate === "string" && body.receivedDate.trim()
        ? body.receivedDate.trim()
        : new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const receivedBy =
      typeof body?.receivedBy === "string" && body.receivedBy.trim()
        ? body.receivedBy.trim()
        : user.name || "Site Representative";
    const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      include: {
        selectedSupplier: { select: { id: true, userId: true, companyName: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.status !== OrderStatus.DISPATCHED) {
      return NextResponse.json(
        {
          error: `Delivery receipt can only be confirmed for dispatched orders. Current status: ${order.status}`,
        },
        { status: 400 }
      );
    }

    const note = `Buyer confirmed material delivery at site (Received by: ${receivedBy} on ${receivedDate})${
      notes ? ` - ${notes}` : ""
    }`;

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

    // Notify buyer via customer order status pipeline (WhatsApp + In-App)
    try {
      await notifyCustomerOrderStatusChanged(prisma as any, {
        orderId: order.id,
        previousStatus: OrderStatus.DISPATCHED,
        newStatus: OrderStatus.DELIVERED,
      });
    } catch (err) {
      console.error(`Failed to dispatch customer_order_status notification for order ${order.id}:`, err);
    }

    // Best-effort in-app notification to the supplier
    if (order.selectedSupplier?.userId) {
      try {
        const orderRef = order.orderNumber || order.enquiryId || order.id.slice(0, 8);
        await prisma.notification.create({
          data: {
            userId: order.selectedSupplier.userId,
            audience: "supplier",
            channel: "IN_APP",
            title: `Delivery Confirmed: ${orderRef}`,
            body: `Buyer confirmed receipt of materials at site for Order ${orderRef} (${note})`,
            status: "delivered",
            read: false,
            variables: JSON.stringify({
              orderId: order.id,
              status: OrderStatus.DELIVERED,
              receivedBy,
              receivedDate,
            }),
          },
        });
      } catch (err) {
        console.error(`Failed to send supplier delivery confirmation notification for order ${order.id}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      id: updated.id,
      status: updated.status,
      note,
    });
  } catch (error) {
    console.error("Confirm delivery POST error:", error);
    return NextResponse.json({ error: "Failed to confirm delivery" }, { status: 500 });
  }
}

