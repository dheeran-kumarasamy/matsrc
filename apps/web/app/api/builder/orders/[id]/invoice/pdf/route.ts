import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { serializeInvoice, invoiceInclude } from "@/lib/invoice-utils";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/builder/orders/[id]/invoice/pdf
// Contractor/Client PDF download of their own generated invoice, built from
// the same stored Invoice/InvoiceLineItem snapshot as the JSON view —
// Form GST INV-01 / E-Invoice & GST Compliance compliant document.
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
      include: invoiceInclude,
    });
    if (!invoiceRow) {
      return NextResponse.json({ error: "No invoice has been generated for this order yet" }, { status: 404 });
    }

    const invoice = serializeInvoice(invoiceRow);
    const buffer = await renderInvoicePdf(invoice);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Builder invoice PDF error:", error);
    return NextResponse.json({ error: "Failed to generate invoice PDF" }, { status: 500 });
  }
}
