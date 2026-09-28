import PDFDocument from "pdfkit";

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
  supplier: { companyName: string; gstin: string | null; email: string | null; phone: string | null } | null;
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
  taxAmount: number;
  totalAmount: number;
  amountPaid: number | null;
  amountDue: number | null;
};

function money(value: number, currency: string): string {
  return `${currency === "INR" ? "\u20B9" : currency + " "}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function renderInvoicePdf(invoice: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(`Invoice ${invoice.invoiceNumber}`, { align: "left" });
    doc
      .fontSize(10)
      .fillColor("#64748b")
      .text(`Invoice date: ${new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}`)
      .text(`Order/Enquiry ref: ${invoice.enquiryId}`)
      .text(`Status: ${invoice.status} · Payment status: ${invoice.paymentStatus}`)
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(12).text("Bill To", { underline: true });
    doc
      .fontSize(10)
      .text(invoice.builder?.name ?? "Contractor/Client")
      .text(invoice.builder?.email ?? "")
      .text(invoice.builder?.phone ?? "");

    if (invoice.site) {
      doc.moveDown(0.5);
      doc.fontSize(12).text("Site", { underline: true });
      doc
        .fontSize(10)
        .text(invoice.site.name)
        .text([invoice.site.addressLine, invoice.site.city, invoice.site.state, invoice.site.pincode].filter(Boolean).join(", "))
        .text(invoice.site.gstin ? `GSTIN: ${invoice.site.gstin}` : "");
    }

    if (invoice.supplier) {
      doc.moveDown(0.5);
      doc.fontSize(12).text("Supplier", { underline: true });
      doc
        .fontSize(10)
        .text(invoice.supplier.companyName)
        .text(invoice.supplier.gstin ? `GSTIN: ${invoice.supplier.gstin}` : "")
        .text([invoice.supplier.email, invoice.supplier.phone].filter(Boolean).join(" · "));
    }

    doc.moveDown();
    doc.fontSize(12).text("Products / Services", { underline: true });
    doc.moveDown(0.3);

    const startX = doc.x;
    let y = doc.y;
    doc.fontSize(9).fillColor("#64748b");
    doc.text("Item", startX, y, { width: 150, continued: false });
    doc.text("Qty", startX + 150, y, { width: 50 });
    doc.text("Unit Price", startX + 200, y, { width: 80 });
    doc.text("Tax", startX + 280, y, { width: 60 });
    doc.text("Total", startX + 340, y, { width: 80 });
    doc.fillColor("#0f172a");
    y += 16;
    doc.moveTo(startX, y).lineTo(startX + 420, y).strokeColor("#e2e8f0").stroke();
    y += 6;

    for (const li of invoice.lineItems) {
      doc.fontSize(9);
      doc.text(li.productName, startX, y, { width: 150 });
      doc.text(String(li.quantity), startX + 150, y, { width: 50 });
      doc.text(money(li.unitPrice, invoice.currency), startX + 200, y, { width: 80 });
      doc.text(money(li.taxAmount, invoice.currency), startX + 280, y, { width: 60 });
      doc.text(money(li.total, invoice.currency), startX + 340, y, { width: 80 });
      y += 18;
    }

    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Subtotal: ${money(invoice.subtotal, invoice.currency)}`, { align: "right" });
    doc.text(`Tax: ${money(invoice.taxAmount, invoice.currency)}`, { align: "right" });
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
