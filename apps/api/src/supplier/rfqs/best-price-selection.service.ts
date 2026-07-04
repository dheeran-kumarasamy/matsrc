import { Injectable } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

export type QuoteCandidate = {
  supplierId: string;
  unitPrice: number;
  leadTimeDays?: number | null;
  createdAt: Date;
};

export type BestLineItemSelection = {
  lineItemId: string;
  supplierId: string;
  unitPrice: number;
  currency: string;
  leadTimeDays?: number | null;
};

export function selectLowestValidQuote(candidates: QuoteCandidate[]): QuoteCandidate {
  if (!candidates.length) {
    throw new Error("No candidates available for best-price selection");
  }

  const sorted = [...candidates].sort((left, right) => {
    if (left.unitPrice !== right.unitPrice) {
      return left.unitPrice - right.unitPrice;
    }

    const leftLead = left.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    const rightLead = right.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    if (leftLead !== rightLead) {
      return leftLead - rightLead;
    }

    const byTimestamp = left.createdAt.getTime() - right.createdAt.getTime();
    if (byTimestamp !== 0) {
      return byTimestamp;
    }

    return left.supplierId.localeCompare(right.supplierId);
  });

  return sorted[0];
}

@Injectable()
export class BestPriceSelectionService {
  constructor(private readonly prisma: PrismaService) {}

  async selectAndFinalizeIfEligible(enquiryId: string): Promise<{
    enquiryId: string;
    selectedSupplierId: string | null;
    selectedSupplierName: string | null;
    bestPriceTotal: number;
    tentativeDeliveryDate: Date;
    lineItems: Array<BestLineItemSelection & { quantity: number; materialName: string }>;
    finalized: boolean;
  } | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: enquiryId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      return null;
    }

    if (order.quoteSelectionCompletedAt) {
      return {
        enquiryId,
        selectedSupplierId: order.selectedSupplierId,
        selectedSupplierName: null,
        bestPriceTotal: Number(order.bestPriceTotal ?? 0),
        tentativeDeliveryDate: order.tentativeDeliveryDate ?? order.deliveryDate ?? new Date(),
        lineItems: [],
        finalized: false,
      };
    }

    const quotes = await this.prisma.supplierQuote.findMany({
      where: { enquiryId },
      orderBy: { createdAt: "desc" },
    });

    if (!quotes.length || !order.items.length) {
      return null;
    }

    const uniqueSuppliers = new Set(quotes.map((quote) => quote.supplierId));
    const minQuotes = this.resolvePositiveNumber(process.env.MIN_QUOTES_FOR_SELECTION, 1);
    const deadlineMinutes = this.resolvePositiveNumber(process.env.QUOTE_DEADLINE_MINUTES, 0);
    const deadlineReached =
      deadlineMinutes > 0 && Date.now() >= order.createdAt.getTime() + deadlineMinutes * 60 * 1000;

    if (!deadlineReached && uniqueSuppliers.size < minQuotes) {
      return null;
    }

    const winningLines: Array<BestLineItemSelection & { quantity: number; materialName: string }> = [];

    for (const item of order.items) {
      const lineQuotes = quotes.filter((quote) => quote.lineItemId === item.id);
      if (!lineQuotes.length) {
        return null;
      }

      const winner = selectLowestValidQuote(
        lineQuotes.map((quote) => ({
          supplierId: quote.supplierId,
          unitPrice: Number(quote.unitPrice),
          leadTimeDays: quote.leadTimeDays,
          createdAt: quote.createdAt,
        }))
      );

      winningLines.push({
        lineItemId: item.id,
        supplierId: winner.supplierId,
        unitPrice: winner.unitPrice,
        currency: lineQuotes[0].currency,
        leadTimeDays: winner.leadTimeDays,
        quantity: item.quantity,
        materialName: item.product.name,
      });
    }

    const bestPriceTotal = winningLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const distinctWinningSuppliers = Array.from(new Set(winningLines.map((line) => line.supplierId)));
    const selectedSupplierId = distinctWinningSuppliers.length === 1 ? distinctWinningSuppliers[0] : null;

    const selectedSupplierProfile = selectedSupplierId
      ? await this.prisma.supplierProfile.findUnique({ where: { id: selectedSupplierId } })
      : null;

    const tentativeDeliveryDate = this.resolveTentativeDeliveryDate({
      requestedDate: order.deliveryDate,
      quoteLeadTimes: winningLines.map((line) => line.leadTimeDays),
      createdAt: order.createdAt,
    });

    await this.prisma.order.update({
      where: { id: enquiryId },
      data: {
        status: order.status === OrderStatus.PLACED ? OrderStatus.PROCESSING : order.status,
        selectedSupplierId,
        bestPriceTotal,
        tentativeDeliveryDate,
        quoteSelectionCompletedAt: new Date(),
      },
    });

    return {
      enquiryId,
      selectedSupplierId,
      selectedSupplierName: selectedSupplierProfile?.companyName ?? null,
      bestPriceTotal,
      tentativeDeliveryDate,
      lineItems: winningLines,
      finalized: true,
    };
  }

  private resolveTentativeDeliveryDate(params: {
    requestedDate: Date | null;
    quoteLeadTimes: Array<number | null | undefined>;
    createdAt: Date;
  }): Date {
    if (params.requestedDate) {
      return params.requestedDate;
    }

    const leadTimeDays = Math.max(
      ...params.quoteLeadTimes.map((value) => (typeof value === "number" && value > 0 ? value : 0)),
      0
    );

    const fallbackDays = this.resolvePositiveNumber(process.env.DEFAULT_LEAD_TIME_DAYS, 3);
    const effectiveDays = leadTimeDays > 0 ? leadTimeDays : fallbackDays;

    const tentative = new Date(params.createdAt);
    tentative.setDate(tentative.getDate() + effectiveDays);
    return tentative;
  }

  private resolvePositiveNumber(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
