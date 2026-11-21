import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { invoiceInclude } from "@/lib/invoice-utils";
import { mapInvoiceToSiteReceiptSheet } from "@/lib/site-receipt-sheet-dto";
import { renderSiteReceiptSheetPdf } from "@/lib/site-receipt-sheet-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/builder/orders/[id]/site-receipt-sheet/pdf
//
// Generates the Site Material Receipt & Verification Sheet PDF for the buyer's
// construction site representative to inspect and record delivered materials.
//
// Security & Authorization:
// - Validates that the requesting user owns the order.
// - Confirms the invoice has been generated for this order.
// - Strips and excludes all financial/pricing data via mapInvoiceToSiteReceiptSheet
//   before passing data into the PDF renderer.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const invoiceRow = await prisma.invoice.findUnique({
      where: { orderId: order.id },
      include: {
        ...invoiceInclude,
        supplier: { select: { companyName: true } },
      },
    });

    if (!invoiceRow) {
      return NextResponse.json(
        { error: "No invoice has been generated for this order yet" },
        { status: 404 }
      );
    }

    // Whitelist mapping guarantees zero financial data enters the PDF payload
    const receiptSheetData = mapInvoiceToSiteReceiptSheet(invoiceRow);
    const buffer = await renderSiteReceiptSheetPdf(receiptSheetData);

    const safeFilename = `${receiptSheetData.receiptSheetNumber.replace(/\//g, "-")}.pdf`;

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
      },
    });
  } catch (error) {
    console.error("Builder site receipt sheet PDF error:", error);
    return NextResponse.json(
      { error: "Failed to generate site receipt sheet PDF" },
      { status: 500 }
    );
  }
}

