import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatDate, humanizeToken } from "src/supplier/utils";
import { NotificationService } from "src/notifications/notification.service";
import { WhatsAppAlertService } from "src/notifications/whatsapp-alerts/whatsapp-alert.service";
import { WhatsAppLifecycleService } from "src/whatsapp/lifecycle/whatsapp-lifecycle.service";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService,
    private readonly notificationService: NotificationService,
    private readonly whatsAppAlertService: WhatsAppAlertService,
    private readonly whatsAppLifecycleService: WhatsAppLifecycleService
  ) {}

  async findAll(user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const items = await this.prisma.orderItem.findMany({
      where: { supplierId: supplierProfile.id },
      include: { order: { include: { user: true } }, product: true },
      orderBy: { order: { createdAt: "desc" } },
    });

    return items.map((item) => ({
      id: item.orderId,
      buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
      material: item.product.name,
      qty: `${item.quantity} ${item.product.unit}`,
      status: item.order.status,
    }));
  }

  async findOne(id: string, user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const item = await this.prisma.orderItem.findFirst({
      where: { orderId: id, supplierId: supplierProfile.id },
      include: {
        order: {
          include: {
            user: true,
            tracking: { orderBy: { recordedAt: "asc" } },
          },
        },
        product: true,
      },
    });

    if (!item) {
      throw new NotFoundException("Order not found");
    }

    return {
      id: item.orderId,
      buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
      deliveryDate: formatDate(item.deliveryDate ?? item.order.deliveryDate),
      quantity: `${item.quantity} ${item.product.unit}`,
      material: item.product.name,
      status: item.order.status,
      tracking: item.order.tracking.map((entry) => ({
        id: entry.id,
        label: entry.note ?? humanizeToken(entry.status),
        status: entry.status,
      })),
    };
  }

  async updateStatus(id: string, status: OrderStatus, user: any, note?: string): Promise<{ id: string; status: OrderStatus }> {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    await this.findOne(id, user);

    // Multi-supplier fan-out: a decline must not immediately cancel the whole
    // enquiry if other eligible candidate suppliers are still pending for any
    // line item — see packages/db/prisma/schema.prisma
    // OrderItemSupplierCandidate doc comment, and the mirrored implementation
    // in apps/supplier/lib/supplier-data.ts (declineOrderForSupplier).
    if (status === OrderStatus.CANCELLED) {
      const result = await this.declineForSupplier(id, supplierProfile.id, note);
      if (result) return result;
    }

    const order = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: {
        items: {
          include: {
            supplier: true,
          },
        },
      },
    });

    await this.prisma.orderTracking.create({
      data: {
        orderId: id,
        status,
        note: note ?? (status === OrderStatus.PROCESSING ? "Supplier confirmed enquiry" : `Supplier marked order as ${humanizeToken(status)}`),
      },
    });


    void this.notificationService.notifyBuilderOrderDecision(id, status).catch((error) => {
      this.logger.warn(`Failed to queue builder notification for order ${id}: ${error instanceof Error ? error.message : String(error)}`);
    });


    // Additive WhatsApp business alert — gated by WHATSAPP_ENABLED + per-user opt-in
    // inside WhatsAppAlertService itself; never blocks/affects the order-status update
    // above, and never throws.
    void this.whatsAppAlertService
      .sendOrderStatusUpdate({
        userId: order.userId,
        orderId: order.id,
        status: order.status,
        supplierName: order.items[0]?.supplier.companyName,
      })
      .catch((error) => {
        this.logger.warn(`Failed to send WhatsApp order-status alert for order ${id}: ${error instanceof Error ? error.message : String(error)}`);
      });

    // Additive WhatsApp lifecycle notifications (order-status template dispatcher) —
    // never blocks/affects the order-status update above, and never throws.
    void this.whatsAppLifecycleService.notifyBuilderOrderStatusTransition(id, order.status).catch((error) => {
      this.logger.warn(`Failed to send WhatsApp lifecycle notification for order ${id}: ${error instanceof Error ? error.message : String(error)}`);
    });

    return { id: order.id, status: order.status };
  }

  // Multi-supplier fan-out: mirrors declineOrderForSupplier in
  // apps/supplier/lib/supplier-data.ts. When the acting supplier declines,
  // mark their candidate row DECLINED for every item they're currently
  // assigned to, promote the next-ranked PENDING candidate (if any) to
  // become the new active supplier for that item, and only actually cancel
  // the order (notifying the builder) once every item has no more eligible
  // candidates left.
  private async declineForSupplier(
    orderId: string,
    supplierId: string,
    reason?: string
  ): Promise<{ id: string; status: OrderStatus } | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { candidates: { orderBy: { rank: "asc" } } } } },
    });
    if (!order) return null;

    const now = new Date();

    for (const item of order.items) {
      if (item.supplierId !== supplierId) continue;

      const ownCandidate = item.candidates.find((c) => c.supplierId === supplierId);
      if (ownCandidate) {
        await this.prisma.orderItemSupplierCandidate.update({
          where: { id: ownCandidate.id },
          data: { status: "DECLINED", declineReason: reason ?? null, respondedAt: now },
        });
      }

      const nextCandidate = item.candidates.find(
        (c) => c.supplierId !== supplierId && c.status === "PENDING"
      );

      if (nextCandidate) {
        await this.prisma.orderItem.update({
          where: { id: item.id },
          data: {
            supplierId: nextCandidate.supplierId,
            unitPrice: nextCandidate.unitPrice,
            resolvedListingId: nextCandidate.listingId ?? undefined,
          },
        });

        void this.notificationService.notifySupplierOrderSubmitted(orderId).catch((error) => {
          this.logger.warn(
            `Failed to notify promoted supplier for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      } else {
        await this.prisma.orderItem.update({
          where: { id: item.id },
          data: { allCandidatesDeclined: true },
        });
      }
    }

    const refreshed = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!refreshed) return null;

    const fullyDeclined = refreshed.items.every((item) => item.allCandidatesDeclined);

    if (fullyDeclined) {
      const cancelled = await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      await this.prisma.orderTracking.create({
        data: {
          orderId,
          status: OrderStatus.CANCELLED,
          note: "All eligible suppliers declined this enquiry",
        },
      });

      void this.notificationService.notifyBuilderOrderDecision(orderId, OrderStatus.CANCELLED).catch((error) => {
        this.logger.warn(
          `Failed to send builder notification for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`
        );
      });

      return { id: cancelled.id, status: cancelled.status };
    }

    // Not fully declined — order remains pending confirmation with the
    // (possibly newly-promoted) supplier(s); builder should NOT see a
    // rejection message.
    await this.prisma.orderTracking.create({
      data: {
        orderId,
        status: OrderStatus.PLACED,
        note: "A supplier declined this enquiry; reassigned to the next eligible supplier",
      },
    });

    return { id: refreshed.id, status: refreshed.status };
  }
}

