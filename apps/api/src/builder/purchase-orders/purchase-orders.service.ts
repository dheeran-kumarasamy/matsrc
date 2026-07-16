import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PurchaseOrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { BuilderContextService } from "src/builder/builder-context.service";
import { NotificationService } from "src/notifications/notification.service";
import { WhatsAppLifecycleService } from "src/whatsapp/lifecycle/whatsapp-lifecycle.service";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";
import { UpdatePurchaseOrderDto } from "./dto/update-purchase-order.dto";
import { ApprovePurchaseOrderDto } from "./dto/approve-purchase-order.dto";

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService,
    private readonly notificationService: NotificationService,
    private readonly whatsAppLifecycleService: WhatsAppLifecycleService
  ) {}

  private async generatePoNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.purchaseOrder.count({
      where: {
        createdAt: {
          gte: new Date(`${year}-01-01T00:00:00.000Z`),
          lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
        },
      },
    });
    const sequence = String(count + 1).padStart(5, "0");
    return `PO-${year}-${sequence}`;
  }

  private serialize(po: any) {
    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      version: po.version,
      notes: po.notes,
      termsSnapshot: po.termsSnapshot,
      approvedAt: po.approvedAt,
      approvedBy: po.approvedBy,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      orderId: po.orderId,
      supplier: {
        id: po.supplier.id,
        companyName: po.supplier.companyName,
      },
      builder: {
        id: po.builder.id,
        name: po.builder.name,
        email: po.builder.email,
      },
      lineItems: po.lineItems.map((li: any) => ({
        id: li.id,
        productId: li.productId,
        productName: li.product.name,
        unit: li.product.unit,
        quantity: li.quantity,
        unitPrice: toNumber(li.unitPrice),
        tax: toNumber(li.tax),
        deliveryDate: li.deliveryDate,
        fulfilledQuantity: li.fulfilledQuantity,
        lineTotal: toNumber(li.unitPrice) * li.quantity + toNumber(li.tax),
      })),
      total: po.lineItems.reduce(
        (acc: number, li: any) => acc + toNumber(li.unitPrice) * li.quantity + toNumber(li.tax),
        0
      ),
      exportUrl: `/builder/purchase-orders/${po.id}/export`,
    };
  }

  async findAll(userCtx: any, status?: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const where: any = { builderId: user.id };
    if (status && Object.values(PurchaseOrderStatus).includes(status as PurchaseOrderStatus)) {
      where.status = status as PurchaseOrderStatus;
    }

    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        builder: true,
        lineItems: { include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return purchaseOrders.map((po) => this.serialize(po));
  }

  async findOne(userCtx: any, id: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, builderId: user.id },
      include: {
        supplier: true,
        builder: true,
        lineItems: { include: { product: true } },
      },
    });

    if (!po) {
      throw new NotFoundException("Purchase order not found");
    }

    return this.serialize(po);
  }

  async exportPo(userCtx: any, id: string) {
    const po = await this.findOne(userCtx, id);
    return {
      documentType: "PURCHASE_ORDER",
      generatedAt: new Date().toISOString(),
      ...po,
    };
  }

  async create(userCtx: any, dto: CreatePurchaseOrderDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, userId: user.id },
      include: {
        items: { include: { product: true, supplier: true } },
      },
    });

    if (!order) {
      throw new NotFoundException("Enquiry/order not found");
    }

    if (!order.quoteSelectionCompletedAt || !order.selectedSupplierId) {
      throw new BadRequestException(
        "Purchase order can only be created after a supplier quote has been accepted for this enquiry"
      );
    }

    // Idempotent: return existing PO for this order if present
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { orderId: order.id, builderId: user.id },
      include: {
        supplier: true,
        builder: true,
        lineItems: { include: { product: true } },
      },
      orderBy: { version: "desc" },
    });

    if (existing) {
      return this.serialize(existing);
    }

    if (!order.items.length) {
      throw new BadRequestException("Enquiry has no line items");
    }

    const poNumber = await this.generatePoNumber();

    const created = await this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        builderId: user.id,
        supplierId: order.selectedSupplierId,
        orderId: order.id,
        status: PurchaseOrderStatus.DRAFT,
        version: 1,
        termsSnapshot: {
          paymentMethod: order.paymentMethod,
          bestPriceTotal: order.bestPriceTotal ? Number(order.bestPriceTotal) : null,
          tentativeDeliveryDate: order.tentativeDeliveryDate,
        },
        lineItems: {
          create: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            tax: 0,
            deliveryDate: item.deliveryDate ?? order.tentativeDeliveryDate ?? null,
          })),
        },
      },
      include: {
        supplier: true,
        builder: true,
        lineItems: { include: { product: true } },
      },
    });

    return this.serialize(created);
  }

  async update(userCtx: any, id: string, dto: UpdatePurchaseOrderDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, builderId: user.id },
      include: { lineItems: true },
    });

    if (!po) {
      throw new NotFoundException("Purchase order not found");
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new ForbiddenException("Purchase order can only be edited while in Draft state");
    }

    if (dto.notes !== undefined) {
      await this.prisma.purchaseOrder.update({
        where: { id },
        data: { notes: dto.notes },
      });
    }

    if (dto.lineItems?.length) {
      const validIds = new Set(po.lineItems.map((li) => li.id));
      for (const lineItem of dto.lineItems) {
        if (!validIds.has(lineItem.id)) {
          throw new BadRequestException(`Line item ${lineItem.id} does not belong to this purchase order`);
        }

        const data: any = {};
        if (lineItem.quantity !== undefined) data.quantity = lineItem.quantity;
        if (lineItem.deliveryDate !== undefined) data.deliveryDate = new Date(lineItem.deliveryDate);

        if (Object.keys(data).length) {
          await this.prisma.purchaseOrderLineItem.update({
            where: { id: lineItem.id },
            data,
          });
        }
      }
    }

    return this.findOne(userCtx, id);
  }

  async approve(userCtx: any, id: string, dto: ApprovePurchaseOrderDto, meta: { ip?: string; userAgent?: string }) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, builderId: user.id },
      include: {
        supplier: { include: { user: true } },
        lineItems: { include: { product: true } },
      },
    });

    if (!po) {
      throw new NotFoundException("Purchase order not found");
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException("Only draft purchase orders can be approved");
    }

    const approverLabel = [dto.approverName, dto.approverDesignation].filter(Boolean).join(" · ") || user.name || user.email;

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.ISSUED,
        approvedAt: new Date(),
        approvedBy: approverLabel,
      },
      include: {
        supplier: true,
        builder: true,
        lineItems: { include: { product: true } },
      },
    });

    // Non-repudiable audit log entry — actor, timestamp, IP/device.
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "PURCHASE_ORDER_ISSUED",
        entityType: "PurchaseOrder",
        entityId: po.id,
        metadata: {
          poNumber: po.poNumber,
          approverLabel,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
          supplierId: po.supplierId,
          orderId: po.orderId,
        },
      },
    });

    // Notify supplier in-app / via existing WhatsApp channel (best-effort, non-blocking).
    const supplierUserId = po.supplier.userId;
    void this.notificationService
      .sendWhatsApp({
        to: po.supplier.user?.whatsappNumber || po.supplier.user?.phone || "",
        title: "New Purchase Order issued",
        body: `PO ${po.poNumber} has been issued for enquiry ${po.orderId.slice(0, 8)}. Please acknowledge in your supplier portal.`,
        context: { poId: po.id, poNumber: po.poNumber },
        idempotencyKey: `po-issued:${po.id}`,
      })
      .catch(() => undefined);

    // Additive WhatsApp lifecycle notification to the Builder (builder_po_issued) —
    // attaches the PO PDF via the existing export URL, never blocks/affects approval.
    void this.whatsAppLifecycleService
      .notifyBuilderPoIssued({
        purchaseOrderId: updated.id,
        orderId: updated.orderId,
        poNumber: updated.poNumber,
        exportUrl: `/builder/purchase-orders/${updated.id}/export`,
      })
      .catch(() => undefined);

    return this.serialize(updated);
  }
}
