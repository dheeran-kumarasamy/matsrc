import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "src/common/pdf-fonts";
import { BUILDOHUB_COMPANY } from "src/common/company-info";

// Renders the STORED AdvanceReceipt snapshot (never live account/ledger
// state) as a PDF buffer, for the Admin-only receipt download route
// (advance-payments.controller.ts's GET :id/receipt/pdf). Mirrors the shape
// and rendering approach of apps/api/src/admin/invoices/invoice-pdf.util.ts
// and the buyer-facing renderer in
// apps/web/app/api/builder/advance/receipts/[id]/pdf/route.ts — kept as a
// separate util (rather than importing across the apps/web/apps/api
// boundary, which this repo never does) so each app owns its own rendering
// code while both read from the exact same AdvanceReceipt row.
export type AdvanceReceiptPdfData = {
  receiptNumber: string;
  issuedAt: Date | string;
  amount: number;
  balanceAfter: number;
  currency: string;
  paymentMethod: string | null;
  paymentReferenceNo: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  advancePaymentReference: string | null;
};

function money(value: number, currency: string): string {
  return `${currency === "INR" ? "\u20B9" : currency + " "}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function renderAdvanceReceiptPdf(receipt: AdvanceReceiptPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    useRupeeCapableFont(doc);

    // Platform identity — the registered parent company operating BuildOhub
    // (Triad Build Tech Private Limited), shown at the top of every receipt
    // alongside its GSTIN/registered address. See src/common/company-info.ts
    // for the single source of truth this is read from.
    doc.fontSize(18).text(BUILDOHUB_COMPANY.name);
    doc
      .fontSize(9)
      .fillColor("#6B6B6B")
      .text(BUILDOHUB_COMPANY.legalName)
      .text([BUILDOHUB_COMPANY.addressLine, BUILDOHUB_COMPANY.city, BUILDOHUB_COMPANY.state, BUILDOHUB_COMPANY.pincode].filter(Boolean).join(", "))
      .text(`GSTIN: ${BUILDOHUB_COMPANY.gstin}`)
      .fillColor("#0f172a");
    doc.fontSize(12).fillColor("#6B6B6B").text("Advance Payment Receipt").fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(14).text(`Receipt No: ${receipt.receiptNumber}`);
    doc
      .fontSize(10)
      .fillColor("#6B6B6B")
      .text(`Issued: ${new Date(receipt.issuedAt).toLocaleString("en-IN")}`)
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(12).text("Buyer Details", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Name: ${receipt.buyerName ?? "-"}`);
    doc.text(`Email: ${receipt.buyerEmail ?? "-"}`);
    doc.text(`Phone: ${receipt.buyerPhone ?? "-"}`);

    doc.moveDown();
    doc.fontSize(12).text("Payment Details", { underline: true });
    doc.moveDown(0.3);
    if (receipt.advancePaymentReference) {
      doc.fontSize(10).text(`Advance Payment Reference: ${receipt.advancePaymentReference}`);
    }
    if (receipt.paymentReferenceNo) {
      doc.fontSize(10).text(`Payment/UTR Reference: ${receipt.paymentReferenceNo}`);
    }
    if (receipt.paymentMethod) {
      doc.fontSize(10).text(`Payment Method: ${receipt.paymentMethod}`);
    }

    doc.moveDown();
    doc.fontSize(12).text(`Amount Received: ${money(receipt.amount, receipt.currency)}`, { align: "right" });
    doc
      .fontSize(10)
      .fillColor("#6B6B6B")
      .text(`Available Advance Balance after this receipt: ${money(receipt.balanceAfter, receipt.currency)}`, { align: "right" });
    doc.fillColor("#0f172a");

    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor("#9E9E9E")
      .text(
        "This is a system-generated receipt confirming settlement of a Buildohub Advance Balance deposit. It does not constitute a GST tax invoice.",
        { align: "left" }
      );

    doc.end();
  });
}
