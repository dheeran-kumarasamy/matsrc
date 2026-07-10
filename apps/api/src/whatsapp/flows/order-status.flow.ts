import { Injectable } from "@nestjs/common";
import { OrderStatus, PurchaseOrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { OrdersService } from "src/supplier/orders/orders.service";
import { WhatsAppSession, BotMessage, MENU_FOOTER } from "../whatsapp.types";
import { WhatsAppSessionService } from "../whatsapp-session.service";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import { matchDeliveredCommand, parseDeliveryDate } from "../whatsapp.utils";

type Bucket = "REQUESTED" | "ACCEPTED" | "REJECTED" | "CONFIRMED" | "DELIVERED";

const BUCKET_ROWS: Array<{ id: Bucket; title: string; description: string }> = [
  { id: "REQUESTED", title: "Requested", description: "New enquiries awaiting your decision" },
  { id: "ACCEPTED", title: "Accepted", description: "Accepted and in progress" },
  { id: "REJECTED", title: "Rejected", description: "Enquiries you declined" },
  { id: "CONFIRMED", title: "Confirmed", description: "Builder-issued purchase orders (read-only)" },
  { id: "DELIVERED", title: "Delivered", description: "Completed deliveries" },
];

/**
 * Flow 3 — Order Status (see spec §6).
 *
 * Status buckets map onto the existing `OrderStatus` enum (there is no native
 * Requested/Accepted/Rejected/Confirmed/Delivered enum in this codebase):
 *   Requested -> OrderStatus.PLACED
 *   Accepted  -> OrderStatus.PROCESSING / DISPATCHED / OUT_FOR_DELIVERY (in progress)
 *   Rejected  -> OrderStatus.CANCELLED
 *   Confirmed -> a linked `PurchaseOrder` in ISSUED/ACKNOWLEDGED — this is builder-driven
 *                and MUST remain read-only here; the bot never mutates PurchaseOrder.
 *   Delivered -> OrderStatus.DELIVERED
 *
 * The only mutation this flow performs is marking an order Delivered, and only when a
 * PurchaseOrder confirms the order was actually issued by the builder (guards against a
 * supplier marking an order "delivered" before it was ever confirmed).
 */
@Injectable()
export class OrderStatusFlow {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly audit: WhatsAppAuditHelper
  ) {}

  async start(session: WhatsAppSession): Promise<BotMessage> {
    this.sessionService.setFlow(session.phone, "ORDER_STATUS", "MENU");
    return {
      kind: "list",
      header: "Order Status",
      body: "Select a status to view orders, or type `DELIVERED <order-id>` to confirm a delivery.",
      rows: BUCKET_ROWS.map((row) => ({ id: row.id, title: row.title, description: row.description })),
    };
  }

  async handle(session: WhatsAppSession, text: string): Promise<BotMessage> {
    // Global inline command, available from any step in this flow.
    const deliveredOrderRef = matchDeliveredCommand(text);
    if (deliveredOrderRef && session.step !== "CONFIRM_DELIVERY_DATE") {
      return this.beginDeliveryConfirmation(session, deliveredOrderRef);
    }

    switch (session.step) {
      case "MENU":
        return this.handleMenuSelect(session, text);
      case "LIST":
        return this.handleOrderSelect(session, text);
      case "ORDER_DETAIL":
        return this.handleOrderDetailChoice(session, text);
      case "CONFIRM_DELIVERY_DATE":
        return this.handleDeliveryDateInput(session, text);
      default:
        return this.start(session);
    }
  }

  private async handleMenuSelect(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const bucket = BUCKET_ROWS.find((row) => row.id === text.trim().toUpperCase())?.id;
    if (!bucket) {
      return { kind: "text", text: "Please select a valid status from the list." };
    }
    return this.presentBucket(session, bucket);
  }

  private async presentBucket(session: WhatsAppSession, bucket: Bucket): Promise<BotMessage> {
    if (bucket === "CONFIRMED") {
      const purchaseOrders = await this.prisma.purchaseOrder.findMany({
        where: { supplierId: session.supplierProfileId, status: { in: [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.ACKNOWLEDGED] } },
        include: { order: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        take: 8,
      });

      if (!purchaseOrders.length) {
        this.sessionService.resetToMainMenu(session.phone);
        return { kind: "text", text: `No confirmed purchase orders right now.\n\n${MENU_FOOTER}` };
      }

      this.sessionService.update(session.phone, {
        step: "LIST",
        context: { bucket, orderIds: purchaseOrders.map((po) => po.orderId) },
      });

      return {
        kind: "list",
        header: "Confirmed (read-only)",
        body: "These are builder-issued purchase orders. Select one to view details.",
        rows: purchaseOrders.map((po) => ({
          id: po.orderId,
          title: `PO ${po.poNumber}`,
          description: `${po.order.user.name ?? po.order.user.phone ?? "Builder"} — ${po.status}`,
        })),
      };
    }

    const statuses = this.bucketToOrderStatuses(bucket);
    const items = await this.prisma.orderItem.findMany({
      where: { supplierId: session.supplierProfileId, order: { status: { in: statuses } } },
      include: { order: { include: { user: true } }, product: true },
      orderBy: { order: { createdAt: "desc" } },
      take: 30,
    });

    const seen = new Set<string>();
    const rows: Array<{ id: string; title: string; description: string }> = [];
    for (const item of items) {
      if (seen.has(item.orderId)) continue;
      seen.add(item.orderId);
      rows.push({
        id: item.orderId,
        title: item.product.name,
        description: `${item.order.user.name ?? item.order.user.phone ?? "Builder"} — ${item.order.status}`,
      });
      if (rows.length >= 8) break;
    }

    if (!rows.length) {
      this.sessionService.resetToMainMenu(session.phone);
      return { kind: "text", text: `No orders in "${bucket}" right now.\n\n${MENU_FOOTER}` };
    }

    this.sessionService.update(session.phone, { step: "LIST", context: { bucket, orderIds: rows.map((row) => row.id) } });

    return {
      kind: "list",
      header: BUCKET_ROWS.find((row) => row.id === bucket)!.title,
      body: "Select an order to view details.",
      rows,
    };
  }

  private async handleOrderSelect(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const orderIds = (session.context.orderIds as string[]) ?? [];
    const orderId = text.trim();
    if (!orderIds.includes(orderId)) {
      return { kind: "text", text: "Please select a valid order from the list." };
    }
    return this.presentOrderDetail(session, orderId);
  }

  private async presentOrderDetail(session: WhatsAppSession, orderId: string): Promise<BotMessage> {
    const detail = await this.ordersService.findOne(orderId, {
      userId: session.userId,
      email: session.email,
      name: session.name,
    });

    const eligibleForDelivery = await this.isEligibleForDelivery(orderId, session.supplierProfileId);

    this.sessionService.update(session.phone, {
      step: "ORDER_DETAIL",
      context: { ...session.context, orderId, eligibleForDelivery },
    });

    const body =
      `Order #${orderId.slice(0, 8)}\n` +
      `Buyer: ${detail.buyer}\n` +
      `Material: ${detail.material}\n` +
      `Qty: ${detail.quantity}\n` +
      `Status: ${detail.status}\n` +
      (detail.deliveryDate ? `Delivery date: ${detail.deliveryDate}\n` : "") +
      `\nHistory:\n${detail.tracking.map((entry) => `• ${entry.label}`).join("\n") || "No tracking yet."}`;

    if (eligibleForDelivery) {
      return {
        kind: "buttons",
        body: `${body}\n\nMark this order as delivered?`,
        buttons: [
          { id: "mark_delivered", title: "Mark Delivered" },
          { id: "back", title: "Back" },
        ],
      };
    }

    return { kind: "text", text: `${body}\n\nReply MENU to return to the main menu, or BACK to go back.` };
  }

  private async handleOrderDetailChoice(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const choice = text.trim().toLowerCase();

    if (choice === "back") {
      const bucket = session.context.bucket as Bucket;
      return this.presentBucket(session, bucket);
    }

    if (choice === "mark_delivered") {
      if (!session.context.eligibleForDelivery) {
        return { kind: "text", text: "This order isn't confirmed by the builder yet, so it can't be marked delivered." };
      }
      const orderId = session.context.orderId as string;
      return this.beginDeliveryConfirmation(session, orderId);
    }

    return { kind: "text", text: "Please tap Mark Delivered or Back." };
  }

  private async beginDeliveryConfirmation(session: WhatsAppSession, orderRef: string): Promise<BotMessage> {
    const orderId = await this.resolveOrderId(orderRef, session.supplierProfileId);
    if (!orderId) {
      return { kind: "text", text: `Couldn't find an order matching "${orderRef}". Check the order id and try again.` };
    }

    const eligible = await this.isEligibleForDelivery(orderId, session.supplierProfileId);
    if (!eligible) {
      return {
        kind: "text",
        text: "This order isn't confirmed by the builder yet (no issued/acknowledged purchase order), so it can't be marked delivered.",
      };
    }

    this.sessionService.update(session.phone, {
      flow: "ORDER_STATUS",
      step: "CONFIRM_DELIVERY_DATE",
      context: { ...session.context, orderId },
    });

    return { kind: "text", text: "Enter the delivery date — reply `TODAY` or `DD-MM-YYYY`:" };
  }

  private async handleDeliveryDateInput(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const date = parseDeliveryDate(text);
    if (!date) {
      const invalidCount = this.sessionService.incrementInvalid(session.phone);
      if (invalidCount >= 3) {
        this.sessionService.resetToMainMenu(session.phone);
        return { kind: "text", text: `Too many invalid attempts. Returning to main menu.\n\n${MENU_FOOTER}` };
      }
      return { kind: "text", text: "Please reply `TODAY` or a valid past/today date as `DD-MM-YYYY`." };
    }

    const orderId = session.context.orderId as string;
    const dateLabel = date.toISOString().slice(0, 10);
    const idempotencyKey = `order-delivered:${orderId}:${dateLabel}`;

    await this.sessionService.withIdempotency(idempotencyKey, async () => {
      await this.ordersService.updateStatus(
        orderId,
        OrderStatus.DELIVERED,
        { userId: session.userId, email: session.email, name: session.name },
        `Supplier confirmed delivery on ${dateLabel}`
      );

      await this.audit.record({
        actorId: session.userId,
        action: "ORDER_DELIVERED_CONFIRM",
        entityType: "Order",
        entityId: orderId,
        metadata: { deliveryDate: dateLabel },
      });
    });

    this.sessionService.resetToMainMenu(session.phone);
    return { kind: "text", text: `✅ Order #${orderId.slice(0, 8)} marked as delivered (${dateLabel}).\n\n${MENU_FOOTER}` };
  }

  private async resolveOrderId(orderRef: string, supplierProfileId: string): Promise<string | null> {
    const exact = await this.prisma.orderItem.findFirst({
      where: { orderId: orderRef, supplierId: supplierProfileId },
    });
    if (exact) return exact.orderId;

    // Allow matching on a short id prefix (e.g. the 8-char slice shown in cards/lists).
    if (orderRef.length >= 4) {
      const candidates = await this.prisma.orderItem.findMany({
        where: { supplierId: supplierProfileId, orderId: { startsWith: orderRef } },
        take: 2,
      });
      if (candidates.length === 1) return candidates[0].orderId;
    }

    return null;
  }

  private async isEligibleForDelivery(orderId: string, supplierProfileId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return false;
    if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) return false;

    const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
      where: {
        orderId,
        supplierId: supplierProfileId,
        status: { in: [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.ACKNOWLEDGED] },
      },
    });

    return !!purchaseOrder;
  }

  private bucketToOrderStatuses(bucket: Bucket): OrderStatus[] {
    switch (bucket) {
      case "REQUESTED":
        return [OrderStatus.PLACED];
      case "ACCEPTED":
        return [OrderStatus.PROCESSING, OrderStatus.DISPATCHED, OrderStatus.OUT_FOR_DELIVERY];
      case "REJECTED":
        return [OrderStatus.CANCELLED];
      case "DELIVERED":
        return [OrderStatus.DELIVERED];
      default:
        return [];
    }
  }
}
