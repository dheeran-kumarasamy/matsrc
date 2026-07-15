import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatDate } from "src/supplier/utils";
import { CreateQuoteDto } from "./dto/create-quote.dto";
import { BestPriceSelectionService } from "./best-price-selection.service";
import { NotificationService } from "src/notifications/notification.service";
import { WhatsAppAlertService } from "src/notifications/whatsapp-alerts/whatsapp-alert.service";

@Injectable()
export class RfqsService {
  private readonly logger = new Logger(RfqsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService,
    private readonly bestPriceSelectionService: BestPriceSelectionService,
    private readonly notificationService: NotificationService,
    private readonly whatsAppAlertService: WhatsAppAlertService
  ) {}

  async findAll(user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const rfqs = await this.prisma.quickRequest.findMany({
      include: {
        quotes: {
          where: { supplierId: supplierProfile.id },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return rfqs.map((rfq) => ({
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
    }));
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

    const bestPriceResult = await this.bestPriceSelectionService.selectAndFinalizeIfEligible(enquiryId);
    if (bestPriceResult?.finalized) {
      const lineItemSummary = bestPriceResult.lineItems
        .map((line) => `${line.materialName}: INR ${line.unitPrice.toLocaleString("en-IN")}/${line.quantity}`)
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
