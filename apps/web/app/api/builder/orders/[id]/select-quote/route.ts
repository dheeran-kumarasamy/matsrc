import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, SupplierQuoteStatus, calculateLineGst } from "@matsrc/db";
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
      const buyerUnitPrice = Number(quote.buyerUnitPrice ?? quote.unitPrice);
      const supplierUnitPrice = Number(quote.unitPrice);
      const markupPercent = Number(quote.markupPercent ?? 0);
      const markupAmount = Number(quote.markupAmount ?? 0);
      const taxRatePercent = Number(quote.gstRatePercent ?? 18);
      const quantity = quote.quantity ?? quote.lineItem.quantity;

      const lineGst = calculateLineGst({
        quantity,
        unitPrice: buyerUnitPrice,
        gstRatePercent: taxRatePercent,
      });

      // 1. Update the OrderItem with the newly selected quotation pricing & supplier
      await tx.orderItem.update({
        where: { id: quote.lineItemId },
        data: {
          supplierId: quote.supplierId,
          unitPrice: buyerUnitPrice,
          supplierUnitPrice,
          markupPercent,
          markupAmount,
          taxRatePercent,
          taxAmount: lineGst.gstAmount,
        },
      });

      // 2. Recalculate totals across all OrderItems
      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { unitPrice: true, quantity: true, taxAmount: true },
      });

      const totalAmount = items.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);
      const taxAmount = items.reduce((sum, i) => sum + (i.taxAmount ? Number(i.taxAmount) : 0), 0);
      const finalPayableAmount = totalAmount + taxAmount;

      // 3. Update the Order record
      const nextStatus = order.status === OrderStatus.PLACED ? OrderStatus.PROCESSING : order.status;
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: nextStatus,
          selectedSupplierId: quote.supplierId,
          selectedQuoteId: quote.id,
          quoteSelectionCompletedAt: new Date(),
          bestPriceTotal: totalAmount,
          totalAmount,
          taxAmount,
          finalPayableAmount,
        },
      });

      // 4. Record audit tracking entry
      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: nextStatus,
          note: isSwitch
            ? `Buyer switched quotation to ${quote.lineItem.product.name} (₹${buyerUnitPrice}/unit)`
            : `Buyer confirmed quotation for ${quote.lineItem.product.name} (₹${buyerUnitPrice}/unit)`,
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
