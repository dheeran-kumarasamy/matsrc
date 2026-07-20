import { prisma } from "@/lib/builder-db";
import { sendWhatsAppMessage } from "@/lib/twilio-whatsapp";

// Lightweight, best-effort WhatsApp notification writer used by the Next.js (apps/web)
// builder API routes. Mirrors the shape produced by apps/api's NotificationService so
// rows show up consistently in the Notification table regardless of which app created
// the order. Uses the same MockWhatsAppProvider-style "instant success" simulation
// (no real WhatsApp API call yet) — failures are swallowed so they never block the
// calling request.
export async function notifySupplierOrderSubmitted(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            product: true,
            supplier: { include: { user: true } },
          },
        },
      },
    });

    if (!order) return;

    const supplierUser = order.items[0]?.supplier.user;
    if (!supplierUser) return;

    const idempotencyKey = `supplier-enquiry:${order.id}:${supplierUser.id}`;
    const existing = await prisma.notification.findFirst({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return;

    const baseUrl =
      process.env.SUPPLIER_PORTAL_URL ||
      process.env.NEXT_PUBLIC_SUPPLIER_APP_URL ||
      "https://matsrc-supplier.vercel.app";
    const deepLink = `${baseUrl.replace(/\/$/, "")}/rfqs?respond=${order.id}`;

    const itemNames = order.items
      .slice(0, 3)
      .map((item) => `${item.product.name} (${item.quantity}${item.product.unit ? ` ${item.product.unit}` : ""})`);
    if (order.items.length > 3) {
      itemNames.push(`+${order.items.length - 3} more`);
    }
    const lineItemSummary = itemNames.length ? itemNames.join(", ") : "No items";

    const title = "New order received";
    const body = `Enquiry ${order.id.slice(0, 8)} from ${order.user.name ?? order.user.phone ?? "a builder"}. Items: ${lineItemSummary}. Quote here: ${deepLink}`;

    const notification = await prisma.notification.create({
      data: {
        userId: supplierUser.id,
        audience: "supplier",
        channel: "WHATSAPP",
        title,
        body,
        status: "queued",
        idempotencyKey,
        templateType: "ENQUIRY_SUBMITTED_TO_SUPPLIER",
        variables: JSON.stringify({
          orderId: order.id,
          orderNumber: order.id.slice(0, 8),
          deepLink,
          builderName: order.user.name ?? order.user.phone,
          itemCount: order.items.length,
          lineItemSummary,
          totalAmount: Number(order.totalAmount),
        }),
        retryCount: 0,
      },
    });

    // Send via Twilio WhatsApp (real send; falls back to a "failed" status if
    // WhatsApp isn't enabled/configured, or the recipient has no number).
    const recipient = supplierUser.whatsappNumber?.trim() || supplierUser.phone?.trim();
    const result = recipient
      ? await sendWhatsAppMessage(recipient, body)
      : { error: "Supplier has no WhatsApp/phone number on file" };

    const success = "externalId" in result;
    await prisma.notification.update({
      where: { id: notification.id },
      data: success
        ? { status: "sent", externalId: result.externalId, deliveredAt: new Date() }
        : { status: "failed", failureReason: result.error, failedAt: new Date() },
    });

    await prisma.notificationDeliveryLog.create({
      data: {
        notificationId: notification.id,
        previousStatus: "queued",
        newStatus: success ? "sent" : "failed",
        provider: "twilio-whatsapp",
        errorMessage: success ? null : result.error,
        metadata: JSON.stringify({ recipient }),
      },
    });
  } catch (error) {
    console.error("notifySupplierOrderSubmitted error:", error);
  }
}


// Best-effort WhatsApp notification fired when a builder generates a Purchase Order.
// Lets the supplier know a PO is ready to view/acknowledge in their portal, following the
// same mock-provider pattern as notifySupplierOrderSubmitted above.
export async function notifySupplierPurchaseOrderGenerated(purchaseOrderId: string): Promise<void> {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        builder: true,
        supplier: { include: { user: true } },
      },
    });

    if (!po) return;

    const supplierUser = po.supplier.user;
    if (!supplierUser) return;

    const idempotencyKey = `purchase-order-generated:${po.id}`;
    const existing = await prisma.notification.findFirst({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return;

    const baseUrl =
      process.env.SUPPLIER_PORTAL_URL ||
      process.env.NEXT_PUBLIC_SUPPLIER_APP_URL ||
      "https://matsrc-supplier.vercel.app";
    const deepLink = `${baseUrl.replace(/\/$/, "")}/purchase-orders/${po.id}`;

    const title = "Purchase Order generated";
    const body = `PO ${po.poNumber} has been generated by ${po.builder.name ?? po.builder.phone ?? "a builder"} for enquiry ${po.orderId.slice(0, 8)}. View it here: ${deepLink}`;

    const notification = await prisma.notification.create({
      data: {
        userId: supplierUser.id,
        audience: "supplier",
        channel: "WHATSAPP",
        title,
        body,
        status: "queued",
        idempotencyKey,
        variables: JSON.stringify({
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
          orderId: po.orderId,
          deepLink,
          builderName: po.builder.name ?? po.builder.phone,
        }),
        retryCount: 0,
      },
    });

    // Send via Twilio WhatsApp (real send; falls back to a "failed" status if
    // WhatsApp isn't enabled/configured, or the recipient has no number).
    const recipient = supplierUser.whatsappNumber?.trim() || supplierUser.phone?.trim();
    const result = recipient
      ? await sendWhatsAppMessage(recipient, body)
      : { error: "Supplier has no WhatsApp/phone number on file" };

    const success = "externalId" in result;
    await prisma.notification.update({
      where: { id: notification.id },
      data: success
        ? { status: "sent", externalId: result.externalId, deliveredAt: new Date() }
        : { status: "failed", failureReason: result.error, failedAt: new Date() },
    });

    await prisma.notificationDeliveryLog.create({
      data: {
        notificationId: notification.id,
        previousStatus: "queued",
        newStatus: success ? "sent" : "failed",
        provider: "twilio-whatsapp",
        errorMessage: success ? null : result.error,
        metadata: JSON.stringify({ recipient }),
      },
    });
  } catch (error) {
    console.error("notifySupplierPurchaseOrderGenerated error:", error);
  }
}


