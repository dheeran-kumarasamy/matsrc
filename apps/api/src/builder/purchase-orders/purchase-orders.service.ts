import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { PurchaseOrderStatus, calculateLineGst } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { BuilderContextService } from "src/builder/builder-context.service";
import { NotificationService } from "src/notifications/notification.service";
import { WhatsAppLifecycleService } from "src/whatsapp/lifecycle/whatsapp-lifecycle.service";
import { SupplierPoReceivedNotificationService } from "src/notification-engine/whatsapp/supplier-po-received-notification.service";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";
import { UpdatePurchaseOrderDto } from "./dto/update-purchase-order.dto";
import { ApprovePurchaseOrderDto } from "./dto/approve-purchase-order.dto";

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService,
    private readonly notificationService: NotificationService,
    private readonly whatsAppLifecycleService: WhatsAppLifecycleService,
    private readonly supplierPoReceivedNotificationService: SupplierPoReceivedNotificationService
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
      // Meaningful Enquiry ID (e.g. "ABC-SITE01-000123") — only present
      // when the caller's query included the `order` relation. See
      // packages/db/lib/enquiry-id.ts.
      enquiryId: po.order?.enquiryId ?? po.orderId,
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
          // Verify and Fix PO Generation to Use Accepted Supplier RFQ Price:
          // `item.unitPrice` here is OrderItem.unitPrice, which
          // BestPriceSelectionService.selectAndFinalizeIfEligible already
          // overwrote with the accepted SupplierQuote.unitPrice at quote-
          // acceptance time (see apps/api/src/supplier/rfqs/
          // best-price-selection.service.ts) — NOT the product's current
          // catalogue/tier price. The PO must never re-derive this from
          // Product.basePrice/PricingTier, so this reads directly off the
          // already-accepted OrderItem row and nothing else.
          //
          // `tax` was previously hard-coded to 0 (GST was never actually
          // computed into the PO at all, regardless of price source) — now
          // computed via the same shared calculateLineGst used by the RFQ
          // quotation flow, from this same accepted unitPrice and the
          // product's existing OrderItem.taxRatePercent (falls back to
          // DEFAULT_TAX_RATE_PERCENT when absent — never hard-coded to a
          // single rate).
          create: order.items.map((item) => {
            const gst = calculateLineGst({
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice),
              gstRatePercent: item.taxRatePercent !== null && item.taxRatePercent !== undefined ? Number(item.taxRatePercent) : null,
            });

            return {
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: gst.unitPrice,
              tax: gst.gstAmount,
              deliveryDate: item.deliveryDate ?? order.tentativeDeliveryDate ?? null,
            };
          }),
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

        // Quantity is deliberately excluded — it is not user-editable on the PO (it
        // must always mirror the confirmed OrderItem.quantity from PO creation time).
        const data: any = {};
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
        order: { select: { enquiryId: true } },
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
        body: `PO ${po.poNumber} has been issued for enquiry ${updated.order.enquiryId ?? po.orderId}. Please acknowledge in your supplier portal.`,
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

    // Notification Engine — supplier_po_alert WhatsApp template
    // (SUPPLIER_PO_RECEIVED). Fires exactly once the PO has actually
    // transitioned DRAFT -> ISSUED above (never at PO creation/DRAFT).
    // Scheduled via Vercel's waitUntil() rather than a detached `void`
    // promise — apps/api runs as a Vercel serverless function, so a
    // detached promise is not guaranteed to finish before the instance is
    // frozen after the HTTP response is sent (see
    // apps/supplier/lib/supplier-data.ts for the full explanation of the
    // production issue this fixes; same pattern already used by
    // OrdersService.updateStatus, BuilderOrdersService.create, and
    // PaymentsService.approve).
    waitUntil(
      this.supplierPoReceivedNotificationService.notify(updated.id).catch((error) => {
        this.logger.warn(
          `Failed to send supplier_po_alert notification for purchaseOrder ${updated.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      })
    );

    return this.serialize(updated);
  }
}
