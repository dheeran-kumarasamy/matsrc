import { prisma } from "@matsrc/db";

// REQ-08: Best-effort WhatsApp notification writer used by the supplier
// portal's direct-Prisma order-status update path (apps/supplier/lib/
// supplier-data.ts -> updateSupplierOrderStatus). Mirrors the exact shape/
// pattern used by apps/web/lib/notify.ts's notifySupplierOrderSubmitted
// (mock "instant success" simulation, no real WhatsApp API call yet) so
// Notification rows are consistent across both apps. Failures are swallowed
// so they never block the calling order-status update.
type BuilderOrderStatus = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

const STATUS_COPY: Record<BuilderOrderStatus, { title: string; body: (supplierName: string) => string; templateType: string } | null> = {
  PLACED: null, // no notification on initial placement — builder already sees this on submission
  PROCESSING: {
    title: "Enquiry confirmed",
    body: (supplierName) => `Good news! ${supplierName} has confirmed your enquiry and is preparing your order.`,
    templateType: "ORDER_ACCEPTED",
  },
  DISPATCHED: {
    title: "Order dispatched",
    body: (supplierName) => `${supplierName} has dispatched your order. It's on its way.`,
    templateType: "ORDER_DISPATCHED",
  },
  OUT_FOR_DELIVERY: {
    title: "Out for delivery",
    body: (supplierName) => `Your order from ${supplierName} is out for delivery.`,
    templateType: "ORDER_OUT_FOR_DELIVERY",
  },
  DELIVERED: {
    title: "Order delivered",
    body: (supplierName) => `Your order from ${supplierName} has been delivered. Thank you for using Matsrc.`,
    templateType: "ORDER_DELIVERED",
  },
  CANCELLED: {
    title: "Order cancelled",
    body: (supplierName) => `${supplierName} has cancelled your order. Please contact support if you have questions.`,
    templateType: "ORDER_DECLINED",
  },
};

export async function notifyBuilderOrderStatusUpdate(orderId: string, status: BuilderOrderStatus): Promise<void> {
  try {
    const copy = STATUS_COPY[status];
    if (!copy) return;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            supplier: true,
          },
        },
      },
    });

    if (!order) return;

    const builderUser = order.user;
    if (!builderUser) return;

    const supplierName = order.items[0]?.supplier.companyName ?? "your supplier";

    // Idempotency per (order, status) — supplier UIs may re-submit the same
    // status transition (e.g. duplicate click); this ensures at most one
    // WhatsApp notification per status change per order.
    const idempotencyKey = `builder-order-status:${orderId}:${status}`;
    const existing = await prisma.notification.findFirst({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return;

    const baseUrl =
      process.env.NEXT_PUBLIC_BUILDER_APP_URL ||
      process.env.BUILDER_PORTAL_URL ||
      "https://matsrc-web.vercel.app";
    const deepLink = `${baseUrl.replace(/\/$/, "")}/orders/${orderId}`;

    const title = copy.title;
    const body = `${copy.body(supplierName)} View details: ${deepLink}`;

    const notification = await prisma.notification.create({
      data: {
        userId: builderUser.id,
        audience: "builder",
        channel: "WHATSAPP",
        title,
        body,
        status: "queued",
        idempotencyKey,
        templateType: copy.templateType as any,
        variables: JSON.stringify({
          orderId,
          orderNumber: orderId.slice(0, 8),
          deepLink,
          supplierName,
          status,
        }),
        retryCount: 0,
      },
    });

    // Simulate provider send (mock — no real WhatsApp API integration yet),
    // matching apps/web/lib/notify.ts's existing simulation pattern.
    const externalId = `mock-wa-${notification.id}`;
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: "sent", externalId, deliveredAt: new Date() },
    });

    await prisma.notificationDeliveryLog.create({
      data: {
        notificationId: notification.id,
        previousStatus: "queued",
        newStatus: "sent",
        provider: "mock-whatsapp",
        metadata: JSON.stringify({ recipient: builderUser.whatsappNumber || builderUser.phone }),
      },
    });
  } catch (error) {
    console.error("notifyBuilderOrderStatusUpdate error:", error);
  }
}
