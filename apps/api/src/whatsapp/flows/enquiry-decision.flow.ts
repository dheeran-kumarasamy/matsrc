import { Injectable } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { OrdersService } from "src/supplier/orders/orders.service";
import { RfqsService } from "src/supplier/rfqs/rfqs.service";
import { WhatsAppSession, BotMessage, MENU_FOOTER } from "../whatsapp.types";
import { WhatsAppSessionService } from "../whatsapp-session.service";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import { parsePositiveNumber } from "../whatsapp.utils";

const REJECT_REASONS = ["Out of stock", "MOQ not met", "Location not serviceable", "Other"];

/**
 * Flow 2 — Accept / Reject Enquiry (see spec §5).
 *
 * "Enquiry" maps to an `Order` in status PLACED that has at least one OrderItem for this
 * supplier. Accept -> OrderStatus.PROCESSING (+ optional quoted price via
 * RfqsService.createQuote). Reject -> OrderStatus.CANCELLED (+ reason stored in
 * OrderTracking.note so it's visible to admin/ops, not dropped).
 */
@Injectable()
export class EnquiryDecisionFlow {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly rfqsService: RfqsService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly audit: WhatsAppAuditHelper
  ) {}

  async start(session: WhatsAppSession): Promise<BotMessage> {
    return this.presentNextEnquiry(session);
  }

  async handle(session: WhatsAppSession, text: string): Promise<BotMessage> {
    switch (session.step) {
      case "CARD":
        return this.handleCardChoice(session, text);
      case "ENTER_QUOTED_PRICE":
        return this.handleQuotedPrice(session, text);
      case "SELECT_REJECT_REASON":
        return this.handleRejectReason(session, text);
      case "ENTER_OTHER_REASON":
        return this.handleOtherReason(session, text);
      default:
        return this.presentNextEnquiry(session);
    }
  }

  private async presentNextEnquiry(session: WhatsAppSession): Promise<BotMessage> {
    const item = await this.prisma.orderItem.findFirst({
      where: {
        supplierId: session.supplierProfileId,
        order: { status: OrderStatus.PLACED },
      },
      include: { order: { include: { user: true } }, product: true },
      orderBy: { order: { createdAt: "asc" } },
    });

    if (!item) {
      this.sessionService.resetToMainMenu(session.phone);
      return { kind: "text", text: `✅ Queue is clear — no pending enquiries.\n\n${MENU_FOOTER}` };
    }

    this.sessionService.setFlow(session.phone, "ENQUIRY_DECISION", "CARD", {
      enquiryId: item.orderId,
      lineItemId: item.id,
      productName: item.product.name,
      quantity: item.quantity,
      unit: item.product.unit,
      builderName: item.order.user.name ?? item.order.user.phone ?? "Builder",
      deliveryLocation: item.order.deliveryDate ? "As specified" : "TBD",
      requestedDate: item.order.deliveryDate?.toISOString().slice(0, 10) ?? "Not specified",
    });

    return {
      kind: "buttons",
      body:
        `Enquiry #${item.orderId.slice(0, 8)}\n` +
        `Builder: ${item.order.user.name ?? item.order.user.phone ?? "Builder"}\n` +
        `Product: ${item.product.name}\n` +
        `Qty: ${item.quantity} ${item.product.unit}\n` +
        `Requested date: ${item.order.deliveryDate?.toISOString().slice(0, 10) ?? "Not specified"}`,
      buttons: [
        { id: "accept", title: "Accept" },
        { id: "reject", title: "Reject" },
        { id: "next", title: "Next" },
      ],
    };
  }

  private async handleCardChoice(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const choice = text.trim().toLowerCase();

    if (choice === "next") {
      return this.presentNextEnquiry(session);
    }

    if (choice === "accept") {
      this.sessionService.update(session.phone, { step: "ENTER_QUOTED_PRICE" });
      return { kind: "text", text: "Enter your quoted price (or leave blank to use the listed price):" };
    }

    if (choice === "reject") {
      this.sessionService.update(session.phone, { step: "SELECT_REJECT_REASON" });
      return {
        kind: "list",
        header: "Rejection reason",
        body: "Why are you rejecting this enquiry?",
        rows: REJECT_REASONS.map((reason, index) => ({ id: String(index + 1), title: reason })),
      };
    }

    return { kind: "text", text: "Please tap Accept, Reject, or Next." };
  }

  private async handleQuotedPrice(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const trimmed = text.trim();
    let quotedPrice: number | null = null;

    if (trimmed.length > 0) {
      quotedPrice = parsePositiveNumber(trimmed);
      if (quotedPrice === null) {
        const invalidCount = this.sessionService.incrementInvalid(session.phone);
        if (invalidCount >= 3) {
          this.sessionService.resetToMainMenu(session.phone);
          return { kind: "text", text: `Too many invalid attempts. Returning to main menu.\n\n${MENU_FOOTER}` };
        }
        return { kind: "text", text: "Please enter a valid numeric price, or leave blank to use the listed price." };
      }
    }

    if (this.sessionService.isRateLimited(session.phone)) {
      return { kind: "text", text: "You're actioning enquiries quickly — please wait a moment and try again." };
    }

    const enquiryId = session.context.enquiryId as string;
    const lineItemId = session.context.lineItemId as string;
    const productName = session.context.productName as string;
    const idempotencyKey = `enquiry-accept:${enquiryId}:${lineItemId}:${quotedPrice ?? "listed"}`;

    await this.sessionService.withIdempotency(idempotencyKey, async () => {
      if (quotedPrice !== null) {
        await this.rfqsService.createQuote(
          enquiryId,
          { price: String(quotedPrice), lineQuotes: [{ lineItemId, unitPrice: String(quotedPrice) }] },
          { userId: session.userId, email: session.email, name: session.name }
        );
      }

      await this.ordersService.updateStatus(
        enquiryId,
        OrderStatus.PROCESSING,
        { userId: session.userId, email: session.email, name: session.name },
        quotedPrice !== null ? `Supplier accepted with quoted price ₹${quotedPrice}` : "Supplier accepted enquiry at listed price"
      );

      await this.audit.record({
        actorId: session.userId,
        action: "ENQUIRY_ACCEPT",
        entityType: "Order",
        entityId: enquiryId,
        metadata: { quotedPrice, productName },
      });
    });

    const confirmation = `✅ Accepted enquiry for ${productName}${quotedPrice !== null ? ` at ₹${quotedPrice}` : " at listed price"}.`;
    const next = await this.presentNextEnquiry(session);
    return this.prepend(confirmation, next);
  }

  private async handleRejectReason(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const trimmed = text.trim();
    const index = Number(trimmed) - 1;
    const reason = REJECT_REASONS[index];

    if (!reason) {
      return { kind: "text", text: "Please select a valid reason number from the list." };
    }

    if (reason === "Other") {
      this.sessionService.update(session.phone, { step: "ENTER_OTHER_REASON" });
      return { kind: "text", text: "Please describe the rejection reason:" };
    }

    return this.finalizeRejection(session, reason);
  }

  private async handleOtherReason(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const reason = text.trim();
    if (!reason) {
      return { kind: "text", text: "Please provide a reason." };
    }
    return this.finalizeRejection(session, reason);
  }

  private async finalizeRejection(session: WhatsAppSession, reason: string): Promise<BotMessage> {
    if (this.sessionService.isRateLimited(session.phone)) {
      return { kind: "text", text: "You're actioning enquiries quickly — please wait a moment and try again." };
    }

    const enquiryId = session.context.enquiryId as string;
    const productName = session.context.productName as string;
    const builderName = (session.context.builderName as string) ?? "Builder";
    const idempotencyKey = `enquiry-reject:${enquiryId}:${reason}`;

    await this.sessionService.withIdempotency(idempotencyKey, async () => {
      await this.ordersService.updateStatus(
        enquiryId,
        OrderStatus.CANCELLED,
        { userId: session.userId, email: session.email, name: session.name },
        `Supplier rejected enquiry — reason: ${reason}`
      );

      // Rejection deliberately routes to Admin, not the Builder — no WhatsApp message
      // to the Builder is sent on this path (see WhatsAppLifecycleService, which has
      // no "order rejected" builder-facing template). Instead a flagged Admin ops-queue
      // record is written to AuditLog with `requiresAdminAction: true`, tagged
      // `channel: "whatsapp"`, so it's filterable/surfacable the same way as the
      // existing WHATSAPP_ESCALATION queue.
      const supplierProfile = await this.prisma.supplierProfile.findUnique({
        where: { id: session.supplierProfileId },
        select: { companyName: true },
      });

      await this.audit.record({
        actorId: session.userId,
        action: "ENQUIRY_REJECT",
        entityType: "Order",
        entityId: enquiryId,
        metadata: {
          reason,
          productName,
          builderName,
          supplierId: session.supplierProfileId,
          supplierName: supplierProfile?.companyName ?? "Supplier",
          channel: "whatsapp",
          requiresAdminAction: true,
        },
      });
    });

    const confirmation = `❌ Rejected enquiry for ${productName}. Reason: ${reason}.`;
    const next = await this.presentNextEnquiry(session);
    return this.prepend(confirmation, next);
  }

  private prepend(prefix: string, message: BotMessage): BotMessage {
    if (message.kind === "text") {
      return { kind: "text", text: `${prefix}\n\n${message.text}` };
    }
    if (message.kind === "buttons") {
      return { ...message, body: `${prefix}\n\n${message.body}` };
    }
    if (message.kind === "list") {
      return { ...message, body: `${prefix}\n\n${message.body}` };
    }
    // Template messages have no free-form body to prepend to (this flow never
    // constructs a template message itself) — return as-is.
    return message;
  }

}
