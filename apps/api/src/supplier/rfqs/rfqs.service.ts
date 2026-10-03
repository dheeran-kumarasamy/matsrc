import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatDate } from "src/supplier/utils";
import { CreateQuoteDto } from "./dto/create-quote.dto";
import { BestPriceSelectionService } from "./best-price-selection.service";
import { NotificationService } from "src/notifications/notification.service";
import { WhatsAppAlertService } from "src/notifications/whatsapp-alerts/whatsapp-alert.service";
import { QuoteReceivedNotificationService } from "src/notification-engine/whatsapp/quote-received-notification.service";

@Injectable()
export class RfqsService {
  private readonly logger = new Logger(RfqsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService,
    private readonly bestPriceSelectionService: BestPriceSelectionService,
    private readonly notificationService: NotificationService,
    private readonly whatsAppAlertService: WhatsAppAlertService,
    private readonly quoteReceivedNotificationService: QuoteReceivedNotificationService
  ) {}

  // Mirrors the equivalent fix in apps/supplier/lib/supplier-data.ts's
  // getSupplierRfqs — the builder-facing "Quick Material Request" form
  // submits into the ordinary cart/checkout enquiry pipeline (Order/
  // OrderItem) rather than creating a QuickRequest row, and no builder UI
  // calls POST /builder/rfqs, so QuickRequest stays empty while real PLACED
  // enquiries keep arriving. Surface both sources here for the same reason.
  async findAll(user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const [rfqs, pendingEnquiryItems] = await Promise.all([
      this.prisma.quickRequest.findMany({
        include: {
          quotes: {
            where: { supplierId: supplierProfile.id },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.orderItem.findMany({
        where: {
          supplierId: supplierProfile.id,
          order: { status: "PLACED" },
        },
        include: { product: true, order: true },
        orderBy: { order: { createdAt: "desc" } },
        take: 20,
      }),
    ]);

    const rfqCards = rfqs.map((rfq) => ({
      id: rfq.id,
      material: rfq.materialName,
      quantity: rfq.quantity,
      pincode: rfq.pincode,
      dueBy: formatDate(new Date(rfq.createdAt.getTime() + 24 * 60 * 60 * 1000)),
      latestQuote: rfq.quotes[0]
        ? {
            price: rfq.quotes[0].price.toString(),
            validUntil: rfq.quotes[0].validUntil?.toISOString() ?? null,
          }
        : null,
      source: "RFQ" as const,
    }));

    const enquiryCards = pendingEnquiryItems.map((item) => ({
      id: item.orderId,
      // Meaningful Enquiry ID (e.g. "ABC-SITE01-000123") — see
      // packages/db/lib/enquiry-id.ts. Falls back to the raw order id for
      // pre-migration orders.
      enquiryId: item.order.enquiryId ?? item.orderId,
      material: item.product.name,
      quantity: `${item.quantity} ${item.product.unit}`,
      pincode: item.order.deliveryAddress ?? "See order for delivery details",
      dueBy: formatDate(item.deliveryDate ?? item.order.deliveryDate),
      latestQuote: null,
      source: "ENQUIRY" as const,
    }));

    return [...rfqCards, ...enquiryCards];
  }

  async findEnquiryQuotes(enquiryId: string, user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const quotes = await this.prisma.supplierQuote.findMany({
      where: {
        enquiryId,
        supplierId: supplierProfile.id,
      },
      orderBy: { createdAt: "desc" },
    });

    return quotes.map((quote) => ({
      id: quote.id,
      enquiryId: quote.enquiryId,
      lineItemId: quote.lineItemId,
      supplierId: quote.supplierId,
      unitPrice: quote.unitPrice.toString(),
      currency: quote.currency,
      leadTimeDays: quote.leadTimeDays,
      createdAt: quote.createdAt,
    }));
  }

  async createQuote(rfqId: string, dto: CreateQuoteDto, user: any): Promise<{ id: string; rfqId: string; price: string }> {
    const hasLineQuotes = Array.isArray(dto.lineQuotes) && dto.lineQuotes.length > 0;
    if (hasLineQuotes) {
      return this.createEnquiryLineQuotes(rfqId, dto, user);
    }

    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    const rfq = await this.prisma.quickRequest.findUnique({ where: { id: rfqId } });

    if (!rfq) {
      throw new NotFoundException("RFQ not found");
    }

    const quote = await this.prisma.quote.create({
      data: {
        supplierId: supplierProfile.id,
        rfqId,
        price: Number(dto.price),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes?.trim() || null,
      },
    });

    return {
      id: quote.id,
      rfqId: quote.rfqId ?? rfqId,
      price: quote.price.toString(),
    };
  }

  private async createEnquiryLineQuotes(
    enquiryId: string,
    dto: CreateQuoteDto,
    user: any
  ): Promise<{ id: string; rfqId: string; price: string }> {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    const enquiry = await this.prisma.order.findUnique({
      where: { id: enquiryId },
      include: { items: true },
    });

    if (!enquiry) {
      throw new NotFoundException("Enquiry not found");
    }

    const itemsById = new Map(enquiry.items.map((item) => [item.id, item]));
    const lineQuotes = dto.lineQuotes ?? [];

    const created = await this.prisma.$transaction(async (tx) => {
      const rows = [] as Array<{ id: string; unitPrice: string }>;

      for (const lineQuote of lineQuotes) {
        const item = itemsById.get(lineQuote.lineItemId);
        if (!item) {
          throw new NotFoundException(`Line item ${lineQuote.lineItemId} not found for enquiry`);
        }

        const quote = await tx.supplierQuote.create({
          data: {
            enquiryId,
            supplierId: supplierProfile.id,
            lineItemId: lineQuote.lineItemId,
            unitPrice: Number(lineQuote.unitPrice),
            currency: (lineQuote.currency || "INR").toUpperCase(),
            leadTimeDays: lineQuote.leadTimeDays,
          },
        });

        rows.push({
          id: quote.id,
          unitPrice: quote.unitPrice.toString(),
        });
      }

      return rows;
    });

    // Notification Engine — quote_received WhatsApp template
    // (QUOTE_RECEIVED event, Meta template ID 1055000930652376). Fires
    // immediately after this supplier's SupplierQuote row(s) have
    // committed — the actual "a supplier has submitted a quotation"
    // business event — independent of whether best-price selection goes on
    // to finalize below (that is a separate, cross-supplier "enough quotes
    // in, auto-confirm" concern; this notification is per-submission). See
    // QuoteReceivedNotificationService's doc comment for the full audit.
    //
    // Scheduled via Vercel's waitUntil() rather than a detached `void`
    // promise — apps/api runs as a Vercel serverless function (see
    // apps/api/api/index.ts / vercel.json), so once this method returns and
    // the HTTP response is sent (or, for the WhatsApp-bot call site, once
    // the bot's own response is sent), Vercel may freeze/terminate the
    // invocation before a merely-`void`'d background promise gets a chance
    // to finish its Meta Graph API round-trip. Mirrors the identical fix
    // already applied to customer_order_status/payment_required at the
    // other call sites in this codebase (see OrdersService.updateStatus /
    // BestPriceSelectionService.selectAndFinalizeIfEligible).
    waitUntil(
      this.quoteReceivedNotificationService
        .notify(
          enquiryId,
          supplierProfile.id,
          created.map((row) => row.id)
        )
        .catch((error) => {
          this.logger.warn(
            `Failed to send quote_received notification for enquiry ${enquiryId} supplier ${supplierProfile.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        })
    );

    const bestPriceResult = await this.bestPriceSelectionService.selectAndFinalizeIfEligible(enquiryId);
    if (bestPriceResult?.finalized) {
      const lineItemSummary = bestPriceResult.lineItems
        .map((line) => `${line.materialName}: ₹${line.unitPrice.toLocaleString("en-IN")}/${line.quantity}`)
        .join(", ");

      void this.notificationService
        .notifyBuilderBestPriceSelected({
          enquiryId,
          bestPriceTotal: bestPriceResult.bestPriceTotal,
          tentativeDeliveryDate: bestPriceResult.tentativeDeliveryDate,
          selectedSupplierId: bestPriceResult.selectedSupplierId,
          selectedSupplierName: bestPriceResult.selectedSupplierName,
          lineItemSummary,
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to queue builder best-price notification for enquiry ${enquiryId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });

      // Additive WhatsApp business alert (RFQ quote-received) — gated by
      // WHATSAPP_ENABLED + per-user opt-in inside WhatsAppAlertService; non-blocking
      // and never throws, alongside the existing notification above.
      void this.whatsAppAlertService
        .sendRfqQuoteReceived({
          userId: enquiry.userId,
          enquiryId,
          supplierName: bestPriceResult.selectedSupplierName,
          bestPriceTotal: bestPriceResult.bestPriceTotal?.toString(),
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to send WhatsApp RFQ quote-received alert for enquiry ${enquiryId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
    }

    const latest = created[created.length - 1];
    return {
      id: latest?.id ?? enquiryId,
      rfqId: enquiryId,
      price: latest?.unitPrice ?? Number(dto.price || 0).toString(),
    };
  }
}
