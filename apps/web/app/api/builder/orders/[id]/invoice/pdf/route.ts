import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { serializeInvoice, invoiceInclude } from "@/lib/invoice-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(value: number, currency: string): string {
  return `${currency === "INR" ? "\u20B9" : currency + " "}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function renderInvoicePdf(invoice: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(`Invoice ${invoice.invoiceNumber}`);
    doc
      .fontSize(10)
      .fillColor("#64748b")
      .text(`Invoice date: ${new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}`)
      .text(`Order/Enquiry ref: ${invoice.enquiryId}`)
      .text(`Payment status: ${invoice.paymentStatus}`)
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(12).text("Products / Services", { underline: true });
    doc.moveDown(0.3);
    for (const li of invoice.lineItems) {
      doc
        .fontSize(9)
        .text(`${li.productName} — ${li.quantity} x ${money(li.unitPrice, invoice.currency)} = ${money(li.total, invoice.currency)}`);
    }

    doc.moveDown();
    doc.fontSize(10).text(`Subtotal: ${money(invoice.subtotal, invoice.currency)}`, { align: "right" });
    doc.text(`Tax: ${money(invoice.taxAmount, invoice.currency)}`, { align: "right" });
    doc.fontSize(12).text(`Total: ${money(invoice.totalAmount, invoice.currency)}`, { align: "right" });

    doc.end();
  });
}

// GET /api/builder/orders/[id]/invoice/pdf
// Contractor/Client PDF download of their own generated invoice, built from
// the same stored Invoice/InvoiceLineItem snapshot as the JSON view above —
// never live order/product pricing, so downloading always reproduces the
// same issued document.
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
