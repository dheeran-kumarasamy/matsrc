import { NextResponse } from "next/server";
import {
  calculateQuoteChargesGst,
  formatDispatchDateIn,
  PaymentStatus,
  SupplierQuoteStatus,
} from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getSupplierDisplayName } from "@/lib/supplier-display";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        enquiryId: true,
        status: true,
        paymentStatus: true,
        selectedSupplierId: true,
        selectedQuoteId: true,
        quoteSelectionCompletedAt: true,
        purchaseOrders: {
          select: { id: true, poNumber: true, status: true },
          take: 1,
        },
        supplierQuotes: {
          where: { status: SupplierQuoteStatus.SENT_TO_BUYER },
          include: {
            supplier: { select: { id: true, companyName: true } },
            lineItem: {
              include: {
                product: { select: { id: true, name: true, unit: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const isLocked = order.paymentStatus === PaymentStatus.PAID || order.purchaseOrders.length > 0;
    const lockReason = order.paymentStatus === PaymentStatus.PAID
      ? "Payment has already been completed"
      : order.purchaseOrders.length > 0
      ? "A Purchase Order has already been generated"
      : null;

    const quotes = order.supplierQuotes.map((quote, idx) => {
      const buyerUnitPrice = Number(quote.buyerUnitPrice ?? quote.unitPrice);
      const quantity = quote.quantity ?? quote.lineItem.quantity;
      const gstRatePercent = quote.gstRatePercent !== null ? Number(quote.gstRatePercent) : 18;
      const lineSubtotal = Number(quote.lineSubtotal ?? (buyerUnitPrice * quantity));
      const gstAmount = Number(quote.gstAmount ?? Math.round(((lineSubtotal * gstRatePercent) / 100 + Number.EPSILON) * 100) / 100);
      const lineTotal = Number(quote.lineTotal ?? (lineSubtotal + gstAmount));

      const isSelected =
        order.selectedQuoteId === quote.id ||
        (order.selectedSupplierId === quote.supplierId && Boolean(order.quoteSelectionCompletedAt));

      const qAny = quote as any;
      const freightCharges = qAny.freightCharges != null ? Number(qAny.freightCharges) : null;
      const loadingCharges = qAny.loadingCharges != null ? Number(qAny.loadingCharges) : null;
      const unloadingCharges = qAny.unloadingCharges != null ? Number(qAny.unloadingCharges) : null;
      const otherCharges = qAny.otherCharges != null ? Number(qAny.otherCharges) : null;
      const dispatchDate = formatDispatchDateIn(qAny.dispatchDate ?? null);
      const chargesGst = calculateQuoteChargesGst({
        freightCharges,
        loadingCharges,
        unloadingCharges,
        otherCharges,
      });

      return {
        id: quote.id,
        supplierId: quote.supplierId,
        supplierName: getSupplierDisplayName(quote.supplier?.companyName, quote.supplierId, idx),
        lineItemId: quote.lineItemId,
        materialName: quote.lineItem.product.name,
        quantity,
        unit: quote.lineItem.product.unit,
        buyerUnitPrice,
        currency: quote.currency,
        leadTimeDays: quote.leadTimeDays,
        freightCharges,
        loadingCharges,
        unloadingCharges,
        otherCharges,
        chargesSubtotal: chargesGst.chargesSubtotal,
        chargesGstAmount: chargesGst.chargesGstAmount,
        chargesTotal: chargesGst.chargesTotal,
        dispatchDate,
        lineSubtotal,
        gstRatePercent,
        gstAmount,
        lineTotal,
        sentToBuyerAt: quote.sentToBuyerAt,
        isSelected,
      };
    });

    return NextResponse.json({
      orderId: order.id,
      enquiryId: order.enquiryId ?? order.id,
      status: order.status,
      isLocked,
      lockReason,
      selectedSupplierId: order.selectedSupplierId,
      selectedQuoteId: order.selectedQuoteId,
      quotes,
    });
  } catch (error) {
    console.error("Failed to load buyer quotes:", error);
    return NextResponse.json({ error: "Failed to load quotations" }, { status: 500 });
  }
}
