import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { OrderStatus, PurchaseOrderStatus, calculateLineGst } from "@matsrc/db";
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

// Purchase-Order Generation Eligibility (Phase 5B) — replaces the previous
// RFQ-metadata-only gate (`!order.quoteSelectionCompletedAt ||
// !order.selectedSupplierId`), which incorrectly rejected a genuinely
// confirmed order whenever it was confirmed through a path that never sets
// those two fields. Phase 5A's audit traced every production writer of
// Order.status and found exactly ONE way an order's status can ever leave
// PLACED: a genuine supplier/payment confirmation through one of the four
// existing confirmation paths —
//   - BestPriceSelectionService.selectAndFinalizeIfEligible (multi-supplier
//     RFQ) — DOES set quoteSelectionCompletedAt/selectedSupplierId.
//   - apps/supplier's updateSupplierOrderStatus (single-supplier "Confirm
//     Enquiry") — DOES set them too.
//   - OrdersService.updateStatus's non-RFQ PLACED -> PROCESSING branch —
//     does NOT set them (pre-existing, documented Phase 3B gap).
//   - PaymentsService.approve's genuine-confirmation branch — does NOT set
//     them either (Phase 4.2).
// VALID_SUPPLIER_TRANSITIONS (apps/api/src/supplier/orders/orders.service.ts)
// and the identical table in apps/supplier/lib/order-status-transitions.ts
// are the single source of truth for the ENTIRE order-status state machine:
// PLACED -> PROCESSING | CANCELLED is the only way out of PLACED, and
// CANCELLED/DELIVERED are terminal. There is no code path anywhere in this
// repository that moves Order.status away from PLACED other than those four
// confirmation paths — so `status !== PLACED && status !== CANCELLED` is a
// reliable, ALREADY-PERSISTED signal of genuine confirmation that works
// identically across all four paths, without requiring
// quoteSelectionCompletedAt/selectedSupplierId/bestPriceTotal/
// tentativeDeliveryDate to ever be fabricated or backfilled.
function isPurchaseOrderEligibleOrderStatus(status: OrderStatus): boolean {
  return status !== OrderStatus.PLACED && status !== OrderStatus.CANCELLED;
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
      lineItems: po.lineItems.map((li: any) => this.buildBuyerPoLineItemView(li)),
      // Uniform GST on Marked-Up Buyer Price: this is the builder
      // (buyer)-facing serialization — see this NestJS PurchaseOrdersModule's
      // own doc comment, mirroring apps/web's lib/purchase-order-utils.ts
      // serializePurchaseOrder exactly. subtotal/taxAmount/total reflect the
      // buyer-facing marked-up basis; the ORIGINAL supplier rate/tax remain
      // available per-line (see buildBuyerPoLineItemView) purely for
      // traceability, never shown as this view's own top-level total.
      subtotal: po.lineItems.reduce((acc: number, li: any) => acc + this.buildBuyerPoLineItemView(li).buyerUnitPrice * li.quantity, 0),
      taxAmount: po.lineItems.reduce((acc: number, li: any) => acc + this.buildBuyerPoLineItemView(li).buyerTax, 0),
      total: po.lineItems.reduce((acc: number, li: any) => acc + this.buildBuyerPoLineItemView(li).lineTotal, 0),
      exportUrl: `/builder/purchase-orders/${po.id}/export`,
    };
  }

  // Uniform GST on Marked-Up Buyer Price — single shared per-line
  // computation reused by both serialize()'s line items AND its top-level
  // subtotal/taxAmount/total reducers above, so the two can never drift
  // apart. GST on the marked-up buyer value is computed via the SAME
  // shared calculateLineGst utility every other GST call site uses (never
  // a second, parallel calculation) — mirrors apps/web's identical
  // buildBuyerPoLineItemView helper exactly.
  private buildBuyerPoLineItemView(li: any) {
    const buyerUnitPrice =
      li.buyerUnitPrice !== null && li.buyerUnitPrice !== undefined ? toNumber(li.buyerUnitPrice) : toNumber(li.unitPrice);
    const taxRatePercent =
      li.taxRatePercent !== null && li.taxRatePercent !== undefined ? toNumber(li.taxRatePercent) : null;

    const buyerGst = calculateLineGst({ quantity: li.quantity, unitPrice: buyerUnitPrice, gstRatePercent: taxRatePercent });

    return {
      id: li.id,
      productId: li.productId,
      productName: li.product.name,
      unit: li.product.unit,
      quantity: li.quantity,
      // Admin-Configurable Product Markup: `unitPrice` here is now the
      // BUYER-FACING marked-up price (this serialization is buyer-only).
      // `originalUnitPrice`/`originalTax` preserve the untouched
      // supplier-side figures, purely for traceability.
      unitPrice: buyerUnitPrice,
      buyerUnitPrice,
      originalUnitPrice: toNumber(li.unitPrice),
      markupPercent: li.markupPercent !== null && li.markupPercent !== undefined ? toNumber(li.markupPercent) : 0,
      markupAmount: li.markupAmount !== null && li.markupAmount !== undefined ? toNumber(li.markupAmount) : 0,
      // Uniform GST on Marked-Up Buyer Price: `tax` is the GST computed on
      // the marked-up buyer value — never the supplier-based `li.tax`
      // persisted at PO-generation time. `originalTax` preserves that
      // original supplier-based figure.
      tax: buyerGst.gstAmount,
      buyerTax: buyerGst.gstAmount,
      originalTax: toNumber(li.tax),
      taxRatePercent: buyerGst.gstRatePercent,
      deliveryDate: li.deliveryDate,
      fulfilledQuantity: li.fulfilledQuantity,
      lineTotal: buyerGst.lineTotal,
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

    // Purchase-Order Generation Eligibility (Phase 5B) — see
    // isPurchaseOrderEligibleOrderStatus's own doc comment above for the
    // full trace of why `status` (rather than quoteSelectionCompletedAt/
    // selectedSupplierId) is the correct, already-persisted signal of
    // genuine confirmation across ALL FOUR existing confirmation paths.
    if (!isPurchaseOrderEligibleOrderStatus(order.status)) {
      throw new BadRequestException(
        order.status === OrderStatus.CANCELLED
          ? "This order has been cancelled and can no longer have a purchase order generated"
          : "Purchase order can only be created after this enquiry has been confirmed by a supplier or payment has been approved"
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

    // Supplier resolution (Phase 5B) — order.selectedSupplierId is ONLY
    // ever populated by the two RFQ-style confirmation paths (see
    // isPurchaseOrderEligibleOrderStatus's doc comment). For an order
    // confirmed via OrdersService.updateStatus or PaymentsService.approve
    // (which never set it), fall back to the order's own, already-frozen
    // OrderItem.supplierId — reusing the SAME single-supplier invariant
    // InvoicesService.generate() already relies on (an Order is created
    // per-supplier group at checkout, see order-checkout.ts), rather than
    // inventing a new resolution rule or fabricating selectedSupplierId.
    let supplierId = order.selectedSupplierId as string | null;
    if (!supplierId) {
      const supplierIds = new Set(order.items.map((item) => item.supplierId));
      if (supplierIds.size > 1) {
        throw new BadRequestException(
          "This order spans multiple suppliers and cannot be represented as a single purchase order"
        );
      }
      supplierId = order.items[0].supplierId;
    }

    const poNumber = await this.generatePoNumber();

    const created = await this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        builderId: user.id,
        supplierId,
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
          // the PO must never re-derive pricing from Product.basePrice/
          // PricingTier, so this reads directly off the already-accepted
          // OrderItem row and nothing else.
          //
          // Admin-Configurable Product Markup: this PurchaseOrder is the
          // Buildohub<->SUPPLIER commercial document in its default
          // "SUPPLIER" rendering mode (see PurchaseOrderLineItem's schema
          // doc comment) — `unitPrice`/`tax` are computed from the
          // ORIGINAL supplier rate (OrderItem.supplierUnitPrice, falling
          // back to OrderItem.unitPrice only for legacy pre-migration rows
          // with no recorded supplier price), never the buyer's marked-up
          // OrderItem.unitPrice. `buyerUnitPrice`/markupPercent/
          // markupAmount mirror the buyer-facing figures for the PO's
          // "BUYER" rendering mode.
          //
          // `tax` was previously hard-coded to 0 (GST was never actually
          // computed into the PO at all, regardless of price source) — now
          // computed via the same shared calculateLineGst used by the RFQ
          // quotation flow, from the supplier rate and the product's
          // existing OrderItem.taxRatePercent (falls back to
          // DEFAULT_TAX_RATE_PERCENT when absent — never hard-coded to a
          // single rate).
          create: order.items.map((item) => {
            const supplierUnitPrice =
              item.supplierUnitPrice !== null && item.supplierUnitPrice !== undefined
                ? Number(item.supplierUnitPrice)
                : Number(item.unitPrice);

            const gst = calculateLineGst({
              quantity: item.quantity,
              unitPrice: supplierUnitPrice,
              gstRatePercent: item.taxRatePercent !== null && item.taxRatePercent !== undefined ? Number(item.taxRatePercent) : null,
            });

            return {
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: gst.unitPrice,
              tax: gst.gstAmount,
              // Persist the RATE alongside the computed amount — see
              // PurchaseOrderLineItem's doc comment in schema.prisma.
              // gst.gstRatePercent is always a resolved number (never
              // null — calculateLineGst() already applies
              // DEFAULT_TAX_RATE_PERCENT when the input omitted it).
              taxRatePercent: gst.gstRatePercent,
              buyerUnitPrice: Number(item.unitPrice),
              markupPercent: item.markupPercent !== null && item.markupPercent !== undefined ? Number(item.markupPercent) : 0,
              markupAmount: item.markupAmount !== null && item.markupAmount !== undefined ? Number(item.markupAmount) : 0,
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
