import { Inject, Injectable, Logger } from "@nestjs/common";
import { OrderStatus, PaymentMethod } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { formatCurrency } from "src/supplier/utils";
import { BotMessage, BotTemplateComponent } from "../whatsapp.types";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import { WHATSAPP_SEND_PROVIDER, WhatsAppSendAdapter } from "../adapters/whatsapp-send.interface";
import { WhatsAppLifecycleConfigService, LifecycleTemplateKey } from "./whatsapp-lifecycle-config.service";
import { WhatsAppLifecycleIdempotencyService } from "./whatsapp-lifecycle-idempotency.service";

function textParam(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

function bodyComponent(values: string[]): BotTemplateComponent {
  return { type: "body", parameters: values.map(textParam) };
}

function documentHeaderComponent(link: string, filename?: string): BotTemplateComponent {
  return { type: "header", parameters: [{ type: "document", document: { link, filename } }] };
}

/**
 * Orchestrates every outbound order/enquiry-lifecycle WhatsApp Utility template for
 * Builders and Suppliers (spec §A-D). Reuses:
 *  - `WhatsAppSendAdapter` (`WHATSAPP_SEND_PROVIDER`) — the same mock/meta/twilio send
 *    abstraction the inbound supplier bot uses, via the `template` BotMessage kind
 *    (pre-approved WhatsApp Message Template sends, outside the 24h session window).
 *  - `WhatsAppAuditHelper` — every send is recorded to the same `AuditLog` table, tagged
 *    `channel: "whatsapp"`, so Admin's audit feed remains a single source of truth.
 *  - `WhatsAppLifecycleIdempotencyService` — a durable (DB-backed, not in-memory)
 *    idempotency guard keyed by event type + order/enquiry id + date where relevant, so
 *    scheduled jobs re-running or handlers firing twice never double-send.
 *
 * Never throws to callers — every public method wraps its work in try/catch and logs,
 * exactly like the existing `WhatsAppAlertService.sendGated` pattern, so a WhatsApp
 * failure never blocks/affects the underlying order/enquiry/PO mutation.
 */
@Injectable()
export class WhatsAppLifecycleService {
  private readonly logger = new Logger(WhatsAppLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_SEND_PROVIDER) private readonly sendAdapter: WhatsAppSendAdapter,
    private readonly audit: WhatsAppAuditHelper,
    private readonly config: WhatsAppLifecycleConfigService,
    private readonly idempotency: WhatsAppLifecycleIdempotencyService
  ) {}

  // ─────────────────────────────────────────────
  // Builder-facing
  // ─────────────────────────────────────────────

  async notifyBuilderOrderPlaced(orderId: string): Promise<void> {
    await this.guarded(`builder-order-placed:${orderId}`, async () => {
      const order = await this.loadOrderForBuilderNotification(orderId);
      if (!order) return;

      await this.sendTemplateToBuilder(order, "builder_order_placed", [
        order.user.name ?? "Builder",
        order.id.slice(0, 8),
        this.lineItemSummary(order.items),
      ]);
    });
  }

  async notifyBuilderEnquiryPendingUpdate(orderId: string): Promise<void> {
    await this.guarded(`builder-enquiry-pending-update:${orderId}`, async () => {
      const order = await this.loadOrderForBuilderNotification(orderId);
      if (!order) return;

      await this.sendTemplateToBuilder(order, "builder_enquiry_pending_update", [
        order.user.name ?? "Builder",
        order.id.slice(0, 8),
      ]);

      await this.prisma.order.update({
        where: { id: orderId },
        data: { reminderSentAt: new Date() },
      });
    });
  }

  async notifyBuilderOrderAccepted(orderId: string): Promise<void> {
    await this.guarded(`builder-order-accepted:${orderId}`, async () => {
      const order = await this.loadOrderForBuilderNotification(orderId);
      if (!order) return;

      await this.sendTemplateToBuilder(order, "builder_order_accepted", [
        order.user.name ?? "Builder",
        order.id.slice(0, 8),
        order.items[0]?.supplier.companyName ?? "Supplier",
      ]);
    });
  }

  /**
   * Fires when PO generation completes (PurchaseOrdersService.create()) — attaches the
   * PO PDF via the existing export URL (`/builder/purchase-orders/:id/export`), not
   * inline base64.
   */
  async notifyBuilderPoIssued(params: {
    purchaseOrderId: string;
    orderId: string;
    poNumber: string;
    exportUrl: string;
  }): Promise<void> {
    await this.guarded(`builder-po-issued:${params.purchaseOrderId}`, async () => {
      const order = await this.loadOrderForBuilderNotification(params.orderId);
      if (!order) return;

      const absoluteExportUrl = this.toAbsoluteBuilderUrl(params.exportUrl);
      const message: BotMessage = {
        kind: "template",
        name: this.config.getTemplateName("builder_po_issued"),
        languageCode: this.config.languageCode(),
        components: [
          documentHeaderComponent(absoluteExportUrl, `${params.poNumber}.pdf`),
          bodyComponent([order.user.name ?? "Builder", params.poNumber]),
        ],
      };

      await this.sendAndAudit(order.user, message, "WHATSAPP_LIFECYCLE_BUILDER_PO_ISSUED", "PurchaseOrder", params.purchaseOrderId, {
        poNumber: params.poNumber,
        orderId: params.orderId,
      });
    });
  }

  /**
   * Fires once a payment link is available for an order (order enters PROCESSING with
   * payment still pending). Branches the template variant on payment mode: CREDIT maps
   * to the BNPL/credit-summary variant, everything else (UPI/CARD/COD/NET_BANKING/
   * BANK_TRANSFER) uses the cash variant.
   */
  async notifyBuilderPaymentLink(orderId: string): Promise<void> {
    await this.guarded(`builder-payment-link:${orderId}`, async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: { include: { creditProfile: true } },
          items: { include: { product: true, supplier: true } },
        },
      });
      if (!order) return;

      const isCredit = order.paymentMethod === PaymentMethod.CREDIT;
      const templateKey: LifecycleTemplateKey = isCredit ? "builder_payment_link_bnpl_credit" : "builder_payment_link_cash";
      const paymentLink = this.toAbsoluteBuilderUrl(`/orders/${order.id}/payment`);

      const bodyValues = isCredit
        ? [
            order.user.name ?? "Builder",
            formatCurrency(order.totalAmount.toString()),
            order.user.creditProfile
              ? formatCurrency(
                  (Number(order.user.creditProfile.creditLimit ?? 0) - Number(order.user.creditProfile.usedLimit ?? 0)).toString()
                )
              : "N/A",
            paymentLink,
          ]
        : [order.user.name ?? "Builder", formatCurrency(order.totalAmount.toString()), paymentLink];

      const message: BotMessage = {
        kind: "template",
        name: this.config.getTemplateName(templateKey),
        languageCode: this.config.languageCode(),
        components: [bodyComponent(bodyValues)],
      };

      await this.sendAndAudit(order.user, message, "WHATSAPP_LIFECYCLE_BUILDER_PAYMENT_LINK", "Order", order.id, {
        paymentMethod: order.paymentMethod,
        variant: isCredit ? "bnpl_credit" : "cash",
      });
    });
  }

  async notifyBuilderDeliveryEta(orderId: string, etaLabel: string): Promise<void> {
    await this.guarded(`builder-delivery-eta:${orderId}:${etaLabel}`, async () => {
      const order = await this.loadOrderForBuilderNotification(orderId);
      if (!order) return;

      await this.sendTemplateToBuilder(order, "builder_delivery_eta", [order.user.name ?? "Builder", etaLabel]);
    });
  }

  async notifyBuilderOrderDispatched(orderId: string): Promise<void> {
    await this.guarded(`builder-order-dispatched:${orderId}`, async () => {
      const order = await this.loadOrderForBuilderNotification(orderId);
      if (!order) return;

      await this.sendTemplateToBuilder(order, "builder_order_dispatched", [order.user.name ?? "Builder", order.id.slice(0, 8)]);
    });
  }

  async notifyBuilderOrderOutForDelivery(orderId: string): Promise<void> {
    await this.guarded(`builder-order-out-for-delivery:${orderId}`, async () => {
      const order = await this.loadOrderForBuilderNotification(orderId);
      if (!order) return;

      await this.sendTemplateToBuilder(order, "builder_order_out_for_delivery", [order.user.name ?? "Builder", order.id.slice(0, 8)]);
    });
  }

  async notifyBuilderOrderDelivered(orderId: string): Promise<void> {
    await this.guarded(`builder-order-delivered:${orderId}`, async () => {
      const order = await this.loadOrderForBuilderNotification(orderId);
      if (!order) return;

      await this.sendTemplateToBuilder(order, "builder_order_delivered", [order.user.name ?? "Builder", order.id.slice(0, 8)]);
    });
  }

  /** Dispatches the correct builder-facing template for a supplier order-status transition. */
  async notifyBuilderOrderStatusTransition(orderId: string, status: OrderStatus): Promise<void> {
    switch (status) {
      case OrderStatus.PROCESSING:
        await this.notifyBuilderOrderAccepted(orderId);
        await this.notifyBuilderPaymentLink(orderId);
        return;
      case OrderStatus.DISPATCHED:
        await this.notifyBuilderOrderDispatched(orderId);
        return;
      case OrderStatus.OUT_FOR_DELIVERY:
        await this.notifyBuilderOrderOutForDelivery(orderId);
        return;
      case OrderStatus.DELIVERED:
        await this.notifyBuilderOrderDelivered(orderId);
        return;
      default:
        // CANCELLED (rejection) intentionally routes to Admin, not the Builder — see
        // EnquiryDecisionFlow.finalizeRejection / WhatsAppLifecycleAdminFlagService.
        // PLACED is handled by notifyBuilderOrderPlaced at order-creation time, not here.
        return;
    }
  }

  // ─────────────────────────────────────────────
  // Supplier-facing
  // ─────────────────────────────────────────────

  /** Fires immediately when an enquiry is created and assigned to a supplier. */
  async notifySupplierNewEnquiry(orderId: string, supplierId: string): Promise<void> {
    await this.guarded(`supplier-new-enquiry:${orderId}:${supplierId}`, async () => {
      const supplierProfile = await this.prisma.supplierProfile.findUnique({
        where: { id: supplierId },
        include: { user: true },
      });
      if (!supplierProfile) return;

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true, items: { where: { supplierId }, include: { product: true } } },
      });
      if (!order) return;

      const message: BotMessage = {
        kind: "template",
        name: this.config.getTemplateName("supplier_new_enquiry_notification"),
        languageCode: this.config.languageCode(),
        components: [
          bodyComponent([
            supplierProfile.companyName,
            order.user.name ?? order.user.phone ?? "A builder",
            this.lineItemSummary(order.items),
          ]),
        ],
      };

      await this.sendAndAudit(
        supplierProfile.user,
        message,
        "WHATSAPP_LIFECYCLE_SUPPLIER_NEW_ENQUIRY",
        "Order",
        orderId,
        { supplierId }
      );
    });
  }

  /** Daily digest: pending enquiries count for a supplier (dedup key includes the date). */
  async notifySupplierPendingEnquiriesReminder(supplierId: string, pendingCount: number, dateKey: string): Promise<void> {
    if (pendingCount <= 0) return;

    await this.guarded(`supplier-pending-enquiries:${supplierId}:${dateKey}`, async () => {
      const supplierProfile = await this.prisma.supplierProfile.findUnique({
        where: { id: supplierId },
        include: { user: true },
      });
      if (!supplierProfile) return;

      const message: BotMessage = {
        kind: "template",
        name: this.config.getTemplateName("supplier_pending_enquiries_reminder"),
        languageCode: this.config.languageCode(),
        components: [bodyComponent([supplierProfile.companyName, String(pendingCount)])],
      };

      await this.sendAndAudit(
        supplierProfile.user,
        message,
        "WHATSAPP_LIFECYCLE_SUPPLIER_PENDING_ENQUIRIES",
        "SupplierProfile",
        supplierId,
        { pendingCount, dateKey }
      );
    });
  }

  /** Daily digest: pending deliveries count for a supplier (dedup key includes the date). */
  async notifySupplierPendingDeliveriesReminder(supplierId: string, pendingCount: number, dateKey: string): Promise<void> {
    if (pendingCount <= 0) return;

    await this.guarded(`supplier-pending-deliveries:${supplierId}:${dateKey}`, async () => {
      const supplierProfile = await this.prisma.supplierProfile.findUnique({
        where: { id: supplierId },
        include: { user: true },
      });
      if (!supplierProfile) return;

      const message: BotMessage = {
        kind: "template",
        name: this.config.getTemplateName("supplier_pending_deliveries_reminder"),
        languageCode: this.config.languageCode(),
        components: [bodyComponent([supplierProfile.companyName, String(pendingCount)])],
      };

      await this.sendAndAudit(
        supplierProfile.user,
        message,
        "WHATSAPP_LIFECYCLE_SUPPLIER_PENDING_DELIVERIES",
        "SupplierProfile",
        supplierId,
        { pendingCount, dateKey }
      );
    });
  }

  /** Fires when an invoice is generated for a delivered order, attaching the PDF. */
  async notifySupplierInvoiceGenerated(params: {
    orderId: string;
    supplierId: string;
    invoiceUrl: string;
  }): Promise<void> {
    await this.guarded(`supplier-invoice-generated:${params.orderId}:${params.supplierId}`, async () => {
      const supplierProfile = await this.prisma.supplierProfile.findUnique({
        where: { id: params.supplierId },
        include: { user: true },
      });
      if (!supplierProfile) return;

      const message: BotMessage = {
        kind: "template",
        name: this.config.getTemplateName("supplier_invoice_generated"),
        languageCode: this.config.languageCode(),
        components: [
          documentHeaderComponent(params.invoiceUrl, `invoice-${params.orderId.slice(0, 8)}.pdf`),
          bodyComponent([supplierProfile.companyName, params.orderId.slice(0, 8)]),
        ],
      };

      await this.sendAndAudit(
        supplierProfile.user,
        message,
        "WHATSAPP_LIFECYCLE_SUPPLIER_INVOICE_GENERATED",
        "Order",
        params.orderId,
        { supplierId: params.supplierId, invoiceUrl: params.invoiceUrl }
      );
    });
  }

  // ─────────────────────────────────────────────
  // Shared helpers
  // ─────────────────────────────────────────────

  private async loadOrderForBuilderNotification(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: { include: { product: true, supplier: true } },
      },
    });
  }

  private async sendTemplateToBuilder(
    order: { id: string; user: { id: string; whatsappNumber: string | null; phone: string | null } },
    templateKey: LifecycleTemplateKey,
    bodyValues: string[]
  ): Promise<void> {
    const message: BotMessage = {
      kind: "template",
      name: this.config.getTemplateName(templateKey),
      languageCode: this.config.languageCode(),
      components: [bodyComponent(bodyValues)],
    };

    await this.sendAndAudit(order.user, message, `WHATSAPP_LIFECYCLE_${templateKey.toUpperCase()}`, "Order", order.id, {});
  }

  private async sendAndAudit(
    recipient: { id: string; whatsappNumber: string | null; phone: string | null },
    message: BotMessage,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const to = recipient.whatsappNumber?.trim() || recipient.phone?.trim();
    if (!to) {
      this.logger.warn(`Skipping WhatsApp lifecycle send (action=${action}, entity=${entityType}:${entityId}): recipient has no phone/whatsappNumber`);
      return;
    }

    const result = await this.sendAdapter.send(to, message);

    await this.audit.record({
      actorId: recipient.id,
      action,
      entityType,
      entityId,
      metadata: {
        ...metadata,
        templateName: message.kind === "template" ? message.name : undefined,
        externalId: result.externalId,
        provider: result.provider,
      },
    });
  }

  private lineItemSummary(items: Array<{ product: { name: string; unit?: string | null }; quantity: number }>): string {
    if (!items.length) return "No items";
    const summary = items.slice(0, 3).map((item) => `${item.product.name} (${item.quantity}${item.product.unit ? ` ${item.product.unit}` : ""})`);
    if (items.length > 3) summary.push(`+${items.length - 3} more`);
    return summary.join(", ");
  }

  private toAbsoluteBuilderUrl(path: string): string {
    const baseUrl = process.env.BUILDER_PORTAL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://web-sable-nine-97.vercel.app";
    return `${baseUrl.replace(/\/$/, "")}${path}`;
  }

  /** Never lets a WhatsApp send failure propagate to the caller. */
  private async guarded(logLabel: string, fn: () => Promise<void>): Promise<void> {
    if (!this.config.isEnabled()) {
      return;
    }

    try {
      await this.idempotency.runOnce(logLabel, fn);
    } catch (error) {
      this.logger.warn(`WhatsApp lifecycle notification failed (${logLabel}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
