import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { useRupeeCapableFont } from "@/lib/pdf-fonts";
import { serializeInvoice, invoiceInclude } from "@/lib/invoice-utils";
import { BUILDOHUB_COMPANY } from "@/lib/company-info";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(value: number, currency: string): string {
  return `${currency === "INR" ? "\u20B9" : currency + " "}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// BuildOhub's brand olive accent (--posh-olive, #A8AE8A — see
// apps/web/app/globals.css) used for this document's section headings.
const OLIVE_ACCENT = "#A8AE8A";

function renderInvoicePdf(invoice: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    useRupeeCapableFont(doc);

    // Platform identity — the registered parent company operating BuildOhub
    // (Triad Build Tech Private Limited), shown at the top of every invoice
    // alongside its GSTIN/registered address. See lib/company-info.ts for
    // the single source of truth this is read from.
    doc.fontSize(14).text(BUILDOHUB_COMPANY.name);
    doc
      .fontSize(9)
      .fillColor("#64748b")
      .text(BUILDOHUB_COMPANY.legalName)
      .text([BUILDOHUB_COMPANY.addressLine, BUILDOHUB_COMPANY.city, BUILDOHUB_COMPANY.state, BUILDOHUB_COMPANY.pincode].filter(Boolean).join(", "))
      .text(`GSTIN: ${BUILDOHUB_COMPANY.gstin}`)
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(18).fillColor(OLIVE_ACCENT).text(`Invoice ${invoice.invoiceNumber}`).fillColor("#0f172a");
    doc
      .fontSize(10)
      .fillColor("#64748b")
      .text(`Invoice date: ${new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}`)
      .text(`Order/Enquiry ref: ${invoice.enquiryId}`)
      .text(`Payment status: ${invoice.paymentStatus}`)
      .fillColor("#0f172a");

    // Ship From / Ship To — location only, never the supplier's identity
    // (the buyer-facing invoice must never disclose which supplier
    // fulfilled the order — see the Supplier Invoice Upload / Admin
    // Verification / Buyer Invoice Generation feature).
    if (invoice.shipFrom) {
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor(OLIVE_ACCENT).text("Ship From", { underline: true }).fillColor("#0f172a");
      doc
        .fontSize(10)
        .text(
          [invoice.shipFrom.addressLine, invoice.shipFrom.city, invoice.shipFrom.state, invoice.shipFrom.pincode]
            .filter(Boolean)
            .join(", ") || "Not configured"
        );
    }

    if (invoice.shipTo) {
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor(OLIVE_ACCENT).text("Ship To", { underline: true }).fillColor("#0f172a");
      doc
        .fontSize(10)
        .text(
          [invoice.shipTo.addressLine, invoice.shipTo.city, invoice.shipTo.state, invoice.shipTo.pincode]
            .filter(Boolean)
            .join(", ") || "Not configured"
        );
    }

    doc.moveDown();
    doc.fontSize(12).fillColor(OLIVE_ACCENT).text("Products / Services", { underline: true }).fillColor("#0f172a");
    doc.moveDown(0.3);
    for (const li of invoice.lineItems) {
      // Explicit GST rate per line — "—" (never a fabricated rate) for
      // pre-migration line items that have no stored taxRate (nullable —
      // see InvoiceLineItem.taxRate in schema.prisma).
      const gstLabel = typeof li.taxRate === "number" ? `${li.taxRate}%` : "\u2014";
      doc
        .fontSize(9)
        .text(
          `${li.productName} — ${li.quantity} x ${money(li.unitPrice, invoice.currency)} ` +
            `(GST ${gstLabel}: ${money(li.taxAmount, invoice.currency)}) = ${money(li.total, invoice.currency)}`
        );
    }

    // Explicit Subtotal / GST / Total breakdown — the GST line is labelled
    // with the actual rate when every line item shares one (the common
    // case), since a single "@X%" suffix would misstate an invoice with
    // genuinely mixed per-line rates.
    const distinctRates = Array.from(
      new Set(invoice.lineItems.map((li: any) => (typeof li.taxRate === "number" ? li.taxRate : null)))
    );
    const uniformRate = distinctRates.length === 1 ? distinctRates[0] : null;
    const taxLabel = uniformRate !== null ? `GST @ ${uniformRate}%` : "Tax";

    // Invoice-level adjustments (audit fix): shown explicitly, each on its
    // own line, ONLY when non-zero — an invoice with no freight/other
    // charges/discount/rounding renders exactly as before this fix. Every
    // amount here is read directly from the stored, confirmed Invoice
    // snapshot — never recomputed from live order/supplier data.
    const hasAdjustments =
      invoice.freightChargeAmount !== 0 ||
      invoice.otherChargesAmount !== 0 ||
      invoice.discountAmount !== 0 ||
      invoice.roundingAdjustment !== 0;

    doc.moveDown();
    doc.fontSize(10).text(`Subtotal: ${money(invoice.subtotal, invoice.currency)}`, { align: "right" });

    if (hasAdjustments) {
      if (invoice.freightChargeAmount !== 0) {
        doc.text(`Freight: ${money(invoice.freightChargeAmount, invoice.currency)}`, { align: "right" });
      }
      if (invoice.otherChargesAmount !== 0) {
        doc.text(`Other Charges: ${money(invoice.otherChargesAmount, invoice.currency)}`, { align: "right" });
      }
      if (invoice.discountAmount !== 0) {
        doc.text(`Discount: -${money(invoice.discountAmount, invoice.currency)}`, { align: "right" });
      }
      doc.text(`Taxable Value: ${money(invoice.taxableValue, invoice.currency)}`, { align: "right" });
    }

    doc.text(`${taxLabel}: ${money(invoice.taxAmount, invoice.currency)}`, { align: "right" });

    if (hasAdjustments && invoice.roundingAdjustment !== 0) {
      doc.text(
        `Rounding: ${invoice.roundingAdjustment > 0 ? "+" : "-"}${money(Math.abs(invoice.roundingAdjustment), invoice.currency)}`,
        { align: "right" }
      );
    }

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
