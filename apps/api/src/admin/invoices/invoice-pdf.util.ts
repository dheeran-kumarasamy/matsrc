import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "src/common/pdf-fonts";
import { BUILDOHUB_COMPANY } from "src/common/company-info";

// Renders the STORED invoice snapshot (never live order/product pricing) as
// a PDF buffer. Reused by both the Admin app and the Contractor/Client
// invoice download routes — see invoices.controller.ts /pdf and
// builder/orders/orders.controller.ts's own invoice PDF route.
//
// Deliberately built from the exact same `serialize()`-shaped invoice
// object InvoicesService returns, so downloading an invoice always
// reproduces the same issued document, regardless of any later change to
// product/order pricing.
export type InvoicePdfData = {
  invoiceNumber: string;
  invoiceDate: string | Date;
  orderId: string;
  enquiryId: string;
  status: string;
  paymentStatus: string;
  currency: string;
  builder: { name: string | null; email: string | null; phone: string | null } | null;
  site: {
    name: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
  } | null;
  // Ship-from/ship-to — location only, NEVER the supplier's identity
  // (name/GSTIN/contact). See the Supplier Invoice Upload / Admin
  // Verification / Buyer Invoice Generation feature's buyer-facing privacy
  // requirement — this PDF must never disclose which supplier fulfilled
  // the order.
  shipFrom: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  shipTo: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  lineItems: Array<{
    productName: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    taxRate: number | null;
    taxAmount: number;
    subtotal: number;
    total: number;
  }>;
  subtotal: number;
  // Invoice-level adjustments + reconciling taxable value (audit fix —
  // see Invoice.taxableValue's schema doc comment). All default to 0/
  // subtotal respectively for historical invoices with no adjustments, so
  // every pre-existing invoice renders unchanged.
  freightChargeAmount: number;
  otherChargesAmount: number;
  discountAmount: number;
  roundingAdjustment: number;
  taxableValue: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number | null;
  amountDue: number | null;
};

function money(value: number, currency: string): string {
  return `${currency === "INR" ? "\u20B9" : currency + " "}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// BuildOhub's brand olive accent (--posh-olive, #A8AE8A — see
// apps/web/app/globals.css) used for this document's section headings, so
// the buyer invoice visually matches the rest of the BuildOhub brand.
const OLIVE_ACCENT = "#4A4A4A";

export function renderInvoicePdf(invoice: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    useRupeeCapableFont(doc);

    // Platform identity — the registered parent company operating BuildOhub
    // (Triad Build Tech Private Limited), shown at the top of every invoice
    // alongside its GSTIN/registered address. See src/common/company-info.ts
    // for the single source of truth this is read from.
    doc.fontSize(14).text(BUILDOHUB_COMPANY.name);
    doc
      .fontSize(9)
      .fillColor("#6B6B6B")
      .text(BUILDOHUB_COMPANY.legalName)
      .text([BUILDOHUB_COMPANY.addressLine, BUILDOHUB_COMPANY.city, BUILDOHUB_COMPANY.state, BUILDOHUB_COMPANY.pincode].filter(Boolean).join(", "))
      .text(`GSTIN: ${BUILDOHUB_COMPANY.gstin}`)
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(18).fillColor(OLIVE_ACCENT).text(`Invoice ${invoice.invoiceNumber}`, { align: "left" }).fillColor("#0f172a");
    doc
      .fontSize(10)
      .fillColor("#6B6B6B")
      .text(`Invoice date: ${new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}`)
      .text(`Order/Enquiry ref: ${invoice.enquiryId}`)
      .text(`Status: ${invoice.status} · Payment status: ${invoice.paymentStatus}`)
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(12).fillColor(OLIVE_ACCENT).text("Bill To", { underline: true }).fillColor("#0f172a");
    doc
      .fontSize(10)
      .text(invoice.builder?.name ?? "Contractor/Client")
      .text(invoice.builder?.email ?? "")
      .text(invoice.builder?.phone ?? "");

    if (invoice.site) {
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor(OLIVE_ACCENT).text("Site", { underline: true }).fillColor("#0f172a");
      doc
        .fontSize(10)
        .text(invoice.site.name)
        .text([invoice.site.addressLine, invoice.site.city, invoice.site.state, invoice.site.pincode].filter(Boolean).join(", "))
        .text(invoice.site.gstin ? `GSTIN: ${invoice.site.gstin}` : "");
    }

    // Ship From / Ship To — location only, never the supplier's identity
    // (mirrors the Purchase Order PDF's "Deliver To" block convention, but
    // additionally shows the dispatch origin location so the buyer can see
    // where the shipment came from without learning who the supplier is).
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

    const startX = doc.x;
    let y = doc.y;
    doc.fontSize(9).fillColor("#6B6B6B");
    doc.text("Item", startX, y, { width: 130, continued: false });
    doc.text("Qty", startX + 130, y, { width: 40 });
    doc.text("Unit Price", startX + 170, y, { width: 70 });
    doc.text("GST %", startX + 240, y, { width: 50 });
    doc.text("Tax", startX + 290, y, { width: 60 });
    doc.text("Total", startX + 350, y, { width: 80 });
    doc.fillColor("#0f172a");
    y += 16;
    doc.moveTo(startX, y).lineTo(startX + 430, y).strokeColor("#D0D0D0").stroke();
    y += 6;

    for (const li of invoice.lineItems) {
      doc.fontSize(9);
      // BUG FIX: this previously advanced y by a fixed 18px per row
      // regardless of how many lines li.productName actually wrapped to,
      // so any description longer than the 130px Item column caused the
      // next row to start drawing while the current row's wrapped text
      // was still rendering — visually merging the two rows together.
      // Measuring the exact string/width/font used to render it (plus
      // generous padding) fixes that, mirroring the same row-height fix
      // already applied to the Purchase Order PDF (see
      // apps/web/lib/purchase-order-pdf.ts).
      const descHeight = doc.heightOfString(li.productName, { width: 130 });
      const rowHeight = Math.max(20, descHeight + 12);
      doc.text(li.productName, startX, y, { width: 130 });
      doc.text(String(li.quantity), startX + 130, y, { width: 40 });
      doc.text(money(li.unitPrice, invoice.currency), startX + 170, y, { width: 70 });
      // Explicit GST rate per line — "—" (never a fabricated rate) for
      // pre-migration line items that have no stored taxRate (nullable —
      // see InvoiceLineItem.taxRate in schema.prisma).
      doc.text(typeof li.taxRate === "number" ? `${li.taxRate}%` : "\u2014", startX + 240, y, { width: 50 });
      doc.text(money(li.taxAmount, invoice.currency), startX + 290, y, { width: 60 });
      doc.text(money(li.total, invoice.currency), startX + 350, y, { width: 80 });
      y += rowHeight;
    }

    // Explicit Subtotal / GST / Total breakdown — the GST line is labelled
    // with the actual rate when every line item shares one (the common
    // case), since a single "@X%" suffix would misstate an invoice with
    // genuinely mixed per-line rates.
    const distinctRates = Array.from(
      new Set(invoice.lineItems.map((li) => (typeof li.taxRate === "number" ? li.taxRate : null)))
    );
    const uniformRate = distinctRates.length === 1 ? distinctRates[0] : null;
    const taxLabel = uniformRate !== null ? `GST @ ${uniformRate}%` : "Tax";

    // Invoice-level adjustments (audit fix): shown explicitly, each on its
    // own line, ONLY when non-zero — so an invoice with no freight/other
    // charges/discount/rounding renders exactly as before this fix
    // (Subtotal / Tax / Total only), while one that has adjustments shows
    // the full reconciling chain: Subtotal -> Freight/Other/Discount ->
    // Taxable Value -> Tax -> Rounding -> Total. Every amount here is read
    // directly from the stored, confirmed Invoice snapshot — never
    // recomputed from live order/supplier data.
    const hasAdjustments =
      invoice.freightChargeAmount !== 0 ||
      invoice.otherChargesAmount !== 0 ||
      invoice.discountAmount !== 0 ||
      invoice.roundingAdjustment !== 0;

    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Subtotal: ${money(invoice.subtotal, invoice.currency)}`, { align: "right" });

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

    if (invoice.amountPaid !== null || invoice.amountDue !== null) {
      doc.moveDown(0.5);
      doc.fontSize(10);
      if (invoice.amountPaid !== null) doc.text(`Amount paid: ${money(invoice.amountPaid, invoice.currency)}`, { align: "right" });
      if (invoice.amountDue !== null) doc.text(`Amount due: ${money(invoice.amountDue, invoice.currency)}`, { align: "right" });
    }

    doc.end();
  });
}
