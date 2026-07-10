import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatDate, humanizeToken } from "src/supplier/utils";
import { NotificationService } from "src/notifications/notification.service";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService,
    private readonly notificationService: NotificationService
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
    await this.findOne(id, user);

    const order = await this.prisma.order.update({
      where: { id },
      data: { status },
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

    return { id: order.id, status: order.status };
  }
}