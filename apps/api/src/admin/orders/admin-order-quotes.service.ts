import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { MarkupService } from "src/admin/markup/markup.service";
import { calculateLineGst, SupplierQuoteStatus } from "@matsrc/db";
import { ReviewAction, ReviewSupplierQuoteDto } from "./dto/review-supplier-quote.dto";

@Injectable()
export class AdminOrderQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markupService: MarkupService
  ) {}

  async listOrders() {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
          },
        },
        purchaseOrders: {
          select: { id: true, poNumber: true, status: true },
        },
        supplierQuotes: {
          select: { id: true, supplierId: true, status: true, unitPrice: true, buyerUnitPrice: true, createdAt: true },
        },
      },
    });

    return orders.map((order) => {
      // Group quotes by supplier to reflect distinct supplier quotations rather than raw line-item quote rows
      const supplierQuoteMap = new Map<string, { statuses: Set<string> }>();
      for (const q of order.supplierQuotes) {
        const sId = (q as any).supplierId || q.id;
        if (!supplierQuoteMap.has(sId)) {
          supplierQuoteMap.set(sId, { statuses: new Set() });
        }
        supplierQuoteMap.get(sId)!.statuses.add(q.status);
      }

      let pendingReviewCount = 0;
      let sentToBuyerCount = 0;

      for (const [, { statuses }] of supplierQuoteMap) {
        if (statuses.has(SupplierQuoteStatus.SENT_TO_BUYER)) {
          sentToBuyerCount++;
        } else if (statuses.has(SupplierQuoteStatus.PENDING_ADMIN_REVIEW)) {
          pendingReviewCount++;
        }
      }

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        enquiryId: order.enquiryId ?? order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        builder: order.user ? { name: order.user.name, email: order.user.email, phone: order.user.phone } : null,
        itemCount: order.items.length,
        items: order.items.map((i) => ({
          id: i.id,
          name: i.product.name,
          quantity: i.quantity,
          unit: i.product.unit,
        })),
        totalQuotesCount: supplierQuoteMap.size,
        pendingReviewCount,
        sentToBuyerCount,
        isLocked: order.paymentStatus === "PAID" || order.purchaseOrders.length > 0,
      };
    });
  }

  async getQuotes(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true, categoryId: true } },
          },
        },
        purchaseOrders: {
          select: { id: true, poNumber: true, status: true, version: true },
          orderBy: { version: "desc" },
        },
        supplierQuotes: {
          include: {
            supplier: { select: { id: true, companyName: true } },
            lineItem: {
              include: {
                product: { select: { id: true, name: true, unit: true, categoryId: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const isLocked = order.paymentStatus === "PAID" || order.purchaseOrders.length > 0;

    const mappedQuotes = await Promise.all(
      order.supplierQuotes.map(async (quote) => {
        const supplierUnitPrice = Number(quote.unitPrice);
        let buyerUnitPrice = quote.buyerUnitPrice !== null ? Number(quote.buyerUnitPrice) : null;
        let markupPercent = quote.markupPercent !== null ? Number(quote.markupPercent) : null;
        let markupAmount = quote.markupAmount !== null ? Number(quote.markupAmount) : null;

        // If not reviewed yet, resolve the system-suggested markup for preview
        if (buyerUnitPrice === null || markupPercent === null) {
          try {
            const suggested = await this.markupService.resolveMarkupForProduct({
              productId: quote.lineItem.product.id,
              categoryId: quote.lineItem.product.categoryId,
              supplierUnitPrice,
            });
            if (suggested) {
              buyerUnitPrice = suggested.buyerUnitPrice;
              markupPercent = suggested.markupPercent;
              markupAmount = suggested.markupAmount;
            } else {
              buyerUnitPrice = supplierUnitPrice;
              markupPercent = 0;
              markupAmount = 0;
            }
          } catch {
            buyerUnitPrice = supplierUnitPrice;
            markupPercent = 0;
            markupAmount = 0;
          }
        }

        const quantity = quote.quantity ?? quote.lineItem.quantity;
        const gstRatePercent = quote.gstRatePercent !== null ? Number(quote.gstRatePercent) : 18;
        const buyerGst = calculateLineGst({
          quantity,
          unitPrice: buyerUnitPrice,
          gstRatePercent,
        });

        const isCurrentlySelected =
          order.selectedQuoteId === quote.id ||
          (order.selectedSupplierId === quote.supplierId && quote.status === SupplierQuoteStatus.SENT_TO_BUYER);

        return {
          id: quote.id,
          enquiryId: quote.enquiryId,
          supplierId: quote.supplierId,
          supplierName: quote.supplier?.companyName ?? "Unknown Supplier",
          lineItemId: quote.lineItemId,
          materialName: quote.lineItem.product.name,
          quantity,
          unit: quote.lineItem.product.unit,
          supplierUnitPrice,
          currency: quote.currency,
          leadTimeDays: quote.leadTimeDays,
          status: quote.status,
          sentToBuyerAt: quote.sentToBuyerAt,
          reviewedByAdminId: quote.reviewedByAdminId,
          adminNotes: quote.adminNotes,
          createdAt: quote.createdAt,
          // Pricing breakdown
          markupPercent,
          markupAmount,
          buyerUnitPrice,
          buyerLineSubtotal: buyerGst.lineSubtotal,
          gstRatePercent,
          buyerGstAmount: buyerGst.gstAmount,
          buyerLineTotal: buyerGst.lineTotal,
          isCurrentlySelected,
        };
      })
    );

    return {
      orderId: order.id,
      enquiryId: order.enquiryId ?? order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      isLocked,
      lockReason: order.paymentStatus === "PAID"
        ? "Payment completed"
        : order.purchaseOrders.length > 0
        ? "Purchase Order generated"
        : null,
      selectedSupplierId: order.selectedSupplierId,
      selectedQuoteId: order.selectedQuoteId,
      builder: order.user ? { name: order.user.name, email: order.user.email, phone: order.user.phone } : null,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.product.id,
        name: i.product.name,
        quantity: i.quantity,
        unit: i.product.unit,
      })),
      quotes: mappedQuotes,
    };
  }

  async reviewQuote(orderId: string, quoteId: string, dto: ReviewSupplierQuoteDto, adminUserId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        purchaseOrders: { select: { id: true } },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (order.paymentStatus === "PAID" || order.purchaseOrders.length > 0) {
      throw new BadRequestException("This order is locked because payment has been completed or a Purchase Order has already been generated.");
    }

    const quote = await this.prisma.supplierQuote.findFirst({
      where: { id: quoteId, enquiryId: orderId },
      include: {
        lineItem: { include: { product: true } },
      },
    });

    if (!quote) {
      throw new NotFoundException("Supplier quote not found for this order");
    }

    if (dto.action === ReviewAction.REJECT) {
      const updated = await this.prisma.supplierQuote.update({
        where: { id: quoteId },
        data: {
          status: SupplierQuoteStatus.REJECTED,
          reviewedByAdminId: adminUserId,
          adminNotes: dto.adminNotes ?? null,
        },
      });

      return {
        success: true,
        action: "REJECTED",
        quote: {
          id: updated.id,
          status: updated.status,
          adminNotes: updated.adminNotes,
        },
      };
    }

    // Handle SEND_TO_BUYER
    const supplierUnitPrice = Number(quote.unitPrice);
    let buyerUnitPrice: number;
    let markupPercent: number;
    let markupAmount: number;

    if (dto.buyerUnitPrice !== undefined && Number.isFinite(dto.buyerUnitPrice) && dto.buyerUnitPrice >= 0) {
      buyerUnitPrice = Math.round((dto.buyerUnitPrice + Number.EPSILON) * 100) / 100;
      markupAmount = Math.max(0, Math.round((buyerUnitPrice - supplierUnitPrice + Number.EPSILON) * 100) / 100);
      markupPercent = supplierUnitPrice > 0 ? Math.round(((markupAmount / supplierUnitPrice) * 100 + Number.EPSILON) * 100) / 100 : 0;
    } else if (dto.markupPercent !== undefined && Number.isFinite(dto.markupPercent) && dto.markupPercent >= 0) {
      markupPercent = Math.round((dto.markupPercent + Number.EPSILON) * 100) / 100;
      buyerUnitPrice = Math.round((supplierUnitPrice * (1 + markupPercent / 100) + Number.EPSILON) * 100) / 100;
      markupAmount = Math.round((buyerUnitPrice - supplierUnitPrice + Number.EPSILON) * 100) / 100;
    } else {
      const suggested = await this.markupService.resolveMarkupForProduct({
        productId: quote.lineItem.product.id,
        categoryId: quote.lineItem.product.categoryId,
        supplierUnitPrice,
      }).catch(() => null);

      buyerUnitPrice = suggested?.buyerUnitPrice ?? supplierUnitPrice;
      markupPercent = suggested?.markupPercent ?? 0;
      markupAmount = suggested?.markupAmount ?? 0;
    }

    const quantity = quote.quantity ?? quote.lineItem.quantity;
    const gstRatePercent = quote.gstRatePercent !== null ? Number(quote.gstRatePercent) : 18;
    const lineGst = calculateLineGst({
      quantity,
      unitPrice: buyerUnitPrice,
      gstRatePercent,
    });

    const updated = await this.prisma.supplierQuote.update({
      where: { id: quoteId },
      data: {
        status: SupplierQuoteStatus.SENT_TO_BUYER,
        sentToBuyerAt: new Date(),
        reviewedByAdminId: adminUserId,
        adminNotes: dto.adminNotes ?? null,
        buyerUnitPrice,
        markupPercent,
        markupAmount,
        lineSubtotal: lineGst.lineSubtotal,
        gstAmount: lineGst.gstAmount,
        lineTotal: lineGst.lineTotal,
      },
    });

    return {
      success: true,
      action: "SENT_TO_BUYER",
      quote: {
        id: updated.id,
        status: updated.status,
        sentToBuyerAt: updated.sentToBuyerAt,
        buyerUnitPrice: Number(updated.buyerUnitPrice),
        markupPercent: Number(updated.markupPercent),
        markupAmount: Number(updated.markupAmount),
        lineTotal: Number(updated.lineTotal),
      },
    };
  }
}
