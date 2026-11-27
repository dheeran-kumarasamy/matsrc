import { NextResponse } from "next/server";
import {
  OrderStatus,
  PaymentStatus,
  SupplierQuoteStatus,
  calculateLineGst,
  calculateQuoteChargesGst,
  closeCompetingSuppliersForOrder,
  roundCurrency,
} from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const { quoteId } = body as { quoteId?: string };

    if (!quoteId || typeof quoteId !== "string") {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      include: {
        purchaseOrders: { select: { id: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Strict Lock Check: Cannot select or switch quote once paid or PO issued
    if (order.paymentStatus === PaymentStatus.PAID) {
      return NextResponse.json(
        { error: "Quotation cannot be changed: Payment has already been completed." },
        { status: 400 }
      );
    }

    if (order.purchaseOrders.length > 0) {
      return NextResponse.json(
        { error: "Quotation cannot be changed: A Purchase Order has already been generated." },
        { status: 400 }
      );
    }

    const hasApprovedAdvance = await prisma.customerAdvanceTransaction.findFirst({
      where: { orderId: order.id, status: "APPROVED" },
    });
    if (hasApprovedAdvance) {
      return NextResponse.json(
        { error: "Quotation cannot be changed: An advance payment has already been verified." },
        { status: 400 }
      );
    }

    // Find the requested quote - must be approved by admin (SENT_TO_BUYER)
    const quote = await prisma.supplierQuote.findFirst({
      where: {
        id: quoteId,
        enquiryId: order.id,
        status: SupplierQuoteStatus.SENT_TO_BUYER,
      },
      include: {
        supplier: { select: { id: true, companyName: true } },
        lineItem: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!quote) {
      return NextResponse.json(
        { error: "Quotation not found or has not been released by Buildohub Admin." },
        { status: 404 }
      );
    }

    const isSwitch = Boolean(order.selectedSupplierId && order.selectedSupplierId !== quote.supplierId);

    await prisma.$transaction(async (tx) => {
      // Find all quotes from this winning supplier for this order that have been approved
      const supplierQuotes = await tx.supplierQuote.findMany({
        where: {
          enquiryId: order.id,
          supplierId: quote.supplierId,
          status: SupplierQuoteStatus.SENT_TO_BUYER,
        },
        include: { lineItem: true },
      });

      // Update all line items covered by this supplier's approved quotes
      for (const sq of supplierQuotes) {
        const sqBuyerUnitPrice = Number(sq.buyerUnitPrice ?? sq.unitPrice);
        const sqSupplierUnitPrice = Number(sq.unitPrice);
        const sqMarkupPercent = Number(sq.markupPercent ?? 0);
        const sqMarkupAmount = Number(sq.markupAmount ?? 0);
        const sqTaxRatePercent = Number(sq.gstRatePercent ?? 18);
        const sqQuantity = sq.quantity ?? sq.lineItem.quantity;

        const lineGst = calculateLineGst({
          quantity: sqQuantity,
          unitPrice: sqBuyerUnitPrice,
          gstRatePercent: sqTaxRatePercent,
        });

        await tx.orderItem.update({
          where: { id: sq.lineItemId },
          data: {
            supplierId: sq.supplierId,
            unitPrice: sqBuyerUnitPrice,
            supplierUnitPrice: sqSupplierUnitPrice,
            markupPercent: sqMarkupPercent,
            markupAmount: sqMarkupAmount,
            taxRatePercent: sqTaxRatePercent,
            taxAmount: lineGst.gstAmount,
          },
        });
      }

      // 2. Recalculate totals across all OrderItems + selected quote's optional charges (with 18% GST)
      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { unitPrice: true, quantity: true, taxAmount: true },
      });

      const quoteWithExtras = (supplierQuotes.find((sq: any) =>
        sq.freightCharges != null ||
        sq.loadingCharges != null ||
        sq.unloadingCharges != null ||
        sq.otherCharges != null ||
        sq.dispatchDate != null
      ) ?? quote) as any;

      const chargesGst = calculateQuoteChargesGst({
        freightCharges: quoteWithExtras?.freightCharges != null ? Number(quoteWithExtras.freightCharges) : 0,
        loadingCharges: quoteWithExtras?.loadingCharges != null ? Number(quoteWithExtras.loadingCharges) : 0,
        unloadingCharges: quoteWithExtras?.unloadingCharges != null ? Number(quoteWithExtras.unloadingCharges) : 0,
        otherCharges: quoteWithExtras?.otherCharges != null ? Number(quoteWithExtras.otherCharges) : 0,
      });

      const totalAmount = roundCurrency(
        items.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0)
      );
      const itemsTaxAmount = roundCurrency(
        items.reduce((sum, i) => sum + (i.taxAmount ? Number(i.taxAmount) : 0), 0)
      );
      const taxAmount = roundCurrency(itemsTaxAmount + chargesGst.chargesGstAmount);
      const finalPayableAmount = roundCurrency(totalAmount + chargesGst.chargesSubtotal + taxAmount);

      // 3. Update the Order record
      const nextStatus = order.status === OrderStatus.PLACED ? OrderStatus.PROCESSING : order.status;
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: nextStatus,
          selectedSupplierId: quote.supplierId,
          selectedQuoteId: quote.id,
          quoteSelectionCompletedAt: new Date(),
          freightCharges: chargesGst.freightCharges,
          loadingCharges: chargesGst.loadingCharges,
          unloadingCharges: chargesGst.unloadingCharges,
          otherCharges: chargesGst.otherCharges,
          dispatchDate: quoteWithExtras?.dispatchDate ?? null,
          bestPriceTotal: totalAmount,
          totalAmount,
          taxAmount,
          finalPayableAmount,
        },
      });

      // 4. Close competing candidate rows, unselected quotes, and notify competing suppliers
      await closeCompetingSuppliersForOrder(tx, {
        orderId: order.id,
        winningSupplierId: quote.supplierId,
        enquiryId: order.enquiryId,
      });

      const chosenQuoteUnitPrice = Number(quote.buyerUnitPrice ?? quote.unitPrice);

      // 5. Record audit tracking entry
      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: nextStatus,
          note: isSwitch
            ? `Buyer switched quotation to ${quote.supplier?.companyName || "supplier"} (₹${chosenQuoteUnitPrice}/unit)`
            : `Buyer confirmed quotation from ${quote.supplier?.companyName || "supplier"} (₹${chosenQuoteUnitPrice}/unit)`,
        },
      });
    });

    return NextResponse.json({
      success: true,
      selectedQuoteId: quote.id,
      selectedSupplierId: quote.supplierId,
      message: isSwitch ? "Quotation switched successfully." : "Quotation confirmed successfully.",
    });
  } catch (error) {
    console.error("Failed to select quotation:", error);
    return NextResponse.json({ error: "Failed to confirm quotation" }, { status: 500 });
  }
}
