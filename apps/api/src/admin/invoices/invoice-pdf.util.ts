import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "src/common/pdf-fonts";
import { BUILDOHUB_COMPANY } from "src/common/company-info";

// Renders the STORED invoice snapshot (never live order/product pricing) as
// a PDF buffer. Reused by both the Admin app and the Contractor/Client
// invoice download routes — see invoices.controller.ts /pdf and
// builder/orders/orders.controller.ts's own invoice PDF route.
//
// Form GST INV-01 / E-Invoice & GST Compliance layout:
// Includes Document Type (INV / Tax Invoice), Supply Type, Reverse Charge flag,
// Place of Supply, Buyer Bill-To & Ship-To, HSN/SAC codes, UQC unit codes,
// intra-state CGST+SGST vs inter-state IGST split, totals in words,
// and platform settlement bank account details.
export type InvoicePdfData = {
  invoiceNumber: string;
  invoiceDate: string | Date;
  orderId: string;
  enquiryId: string;
  status: string;
  paymentStatus: string;
  currency: string;
  documentType?: string;
  supplyType?: string;
  reverseCharge?: boolean;
  placeOfSupplyStateCode?: string | null;
  placeOfSupplyStateName?: string | null;
  sellerStateCode?: string;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  cessAmount?: number;
  totalInWords?: string;
  builder?: { name: string | null; email: string | null; phone: string | null } | null;
  buyer?: {
    legalName: string | null;
    tradeName: string | null;
    gstin: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    stateCode: string | null;
  } | null;
  site?: {
    name: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
  } | null;
  shipFrom?: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  shipTo?: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  lineItems: Array<{
    slNo?: number;
    productName: string;
    description: string | null;
    hsnCode?: string | null;
    uqc?: string | null;
    unit?: string | null;
    quantity: number;
    unitPrice: number;
    taxableAmount?: number;
    taxRate: number | null;
    cgstRate?: number | null;
    cgstAmount?: number;
    sgstRate?: number | null;
    sgstAmount?: number;
    igstRate?: number | null;
    igstAmount?: number;
    taxAmount: number;
    subtotal: number;
    total: number;
  }>;
  subtotal: number;
  freightChargeAmount: number;
  otherChargesAmount: number;
  discountAmount: number;
  roundingAdjustment: number;
  taxableValue: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number | null;
  amountDue: number | null;
  paymentDueBy?: string;
  bankDetails?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    accountType?: string;
    ifscCode: string;
    branch: string;
    bankAddress?: string;
  };
};

function money(value: number, currency: string): string {
  return `${currency === "INR" ? "\u20B9" : currency + " "}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const OLIVE_ACCENT = "#4A4A4A";

export function renderInvoicePdf(invoice: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    useRupeeCapableFont(doc);

    const startX = 36;
    const pageWidth = 523; // 595 - 72

    const sellerStateCode = invoice.sellerStateCode ?? (BUILDOHUB_COMPANY as any).stateCode ?? "33";
    const posCode = invoice.placeOfSupplyStateCode ?? sellerStateCode;
    const posName = invoice.placeOfSupplyStateName ?? "Tamil Nadu";
    const isIntraState = sellerStateCode === posCode;

    // Header Left: Platform Identity
    doc.fontSize(14).fillColor("#0f172a").text(BUILDOHUB_COMPANY.name, startX, 36);
    doc
      .fontSize(8.5)
      .fillColor("#64748b")
      .text(BUILDOHUB_COMPANY.legalName, startX, 54)
      .text([BUILDOHUB_COMPANY.addressLine, BUILDOHUB_COMPANY.city, BUILDOHUB_COMPANY.state, BUILDOHUB_COMPANY.pincode].filter(Boolean).join(", "), startX, 66)
      .fillColor("#0f172a")
      .text(`GSTIN: ${BUILDOHUB_COMPANY.gstin} | State Code: ${sellerStateCode} (Tamil Nadu)`, startX, 78);

    // Header Right: Tax Invoice Details
    doc
      .fontSize(14)
      .fillColor(OLIVE_ACCENT)
      .text("TAX INVOICE", startX + 280, 36, { width: 243, align: "right" });
    doc
      .fontSize(9)
      .fillColor("#0f172a")
      .text(`Invoice No: ${invoice.invoiceNumber}`, startX + 280, 54, { width: 243, align: "right" });
    doc
      .fontSize(8.5)
      .fillColor("#64748b")
      .text(`Date: ${new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}`, startX + 280, 66, { width: 243, align: "right" })
      .text(`Order/Enquiry Ref: ${invoice.enquiryId}`, startX + 280, 78, { width: 243, align: "right" })
      .text(`Place of Supply: ${posCode} - ${posName}`, startX + 280, 90, { width: 243, align: "right" })
      .text(`Supply: ${invoice.supplyType ?? "B2B"} | Rev. Charge: ${invoice.reverseCharge ? "Yes" : "No"}`, startX + 280, 102, { width: 243, align: "right" });

    doc.moveTo(startX, 118).lineTo(startX + pageWidth, 118).strokeColor("#D0D0D0").stroke();

    // 2-Column Parties Grid: Bill To (Buyer) vs Ship To (Delivery Site)
    const partyY = 126;
    const colWidth = 250;

    // Bill To
    const buyerName = invoice.buyer?.legalName ?? invoice.builder?.name ?? "Contractor/Client";
    const buyerAddress =
      [invoice.buyer?.addressLine ?? invoice.site?.addressLine, invoice.buyer?.city ?? invoice.site?.city, invoice.buyer?.state ?? invoice.site?.state, invoice.buyer?.pincode ?? invoice.site?.pincode]
        .filter(Boolean)
        .join(", ") || "Not configured";
    const buyerGstin = invoice.buyer?.gstin ?? invoice.site?.gstin ?? "URP";
    const buyerState = invoice.buyer?.state ?? invoice.site?.state ?? posName;
    const buyerStateCode = invoice.buyer?.stateCode ?? posCode;

    doc.fontSize(10).fillColor(OLIVE_ACCENT).text("BILL TO (RECIPIENT)", startX, partyY, { underline: true });
    doc
      .fontSize(9)
      .fillColor("#0f172a")
      .text(buyerName, startX, partyY + 14, { width: colWidth })
      .fillColor("#64748b")
      .text(`Address: ${buyerAddress}`, startX, partyY + 26, { width: colWidth })
      .text(`GSTIN: ${buyerGstin} | State: ${buyerState} (${buyerStateCode})`, startX, partyY + 50, { width: colWidth });

    // Ship To
    const shipToX = startX + 273;
    const siteName = invoice.site?.name ?? "Site Delivery";
    const shipToAddress =
      [invoice.shipTo?.addressLine ?? invoice.site?.addressLine, invoice.shipTo?.city ?? invoice.site?.city, invoice.shipTo?.state ?? invoice.site?.state, invoice.shipTo?.pincode ?? invoice.site?.pincode]
        .filter(Boolean)
        .join(", ") || "Not configured";

    doc.fontSize(10).fillColor(OLIVE_ACCENT).text("SHIP TO (DELIVERY SITE)", shipToX, partyY, { underline: true });
    doc
      .fontSize(9)
      .fillColor("#0f172a")
      .text(siteName, shipToX, partyY + 14, { width: colWidth })
      .fillColor("#64748b")
      .text(`Address: ${shipToAddress}`, shipToX, partyY + 26, { width: colWidth })
      .text(`State: ${invoice.shipTo?.state ?? posName} (${posCode})`, shipToX, partyY + 50, { width: colWidth });

    let currentY = partyY + 68;

    if (invoice.shipFrom) {
      const shipFromText = [invoice.shipFrom.addressLine, invoice.shipFrom.city, invoice.shipFrom.state, invoice.shipFrom.pincode].filter(Boolean).join(", ");
      if (shipFromText) {
        doc.fontSize(8).fillColor("#64748b").text(`Dispatch Origin: ${shipFromText}`, startX, currentY, { width: pageWidth });
        currentY += 14;
      }
    }

    doc.moveTo(startX, currentY).lineTo(startX + pageWidth, currentY).strokeColor("#D0D0D0").stroke();
    currentY += 8;

    // Line Items Table Header
    doc.fontSize(8.5).fillColor("#64748b");
    doc.text("Sl", startX, currentY, { width: 18 });
    doc.text("Item / Description", startX + 20, currentY, { width: 170 });
    doc.text("HSN", startX + 192, currentY, { width: 40 });
    doc.text("Qty & Unit", startX + 234, currentY, { width: 52 });
    doc.text("Rate", startX + 288, currentY, { width: 48 });
    doc.text("Taxable", startX + 338, currentY, { width: 50 });

    if (isIntraState) {
      doc.text("CGST", startX + 390, currentY, { width: 42 });
      doc.text("SGST", startX + 434, currentY, { width: 42 });
    } else {
      doc.text("IGST", startX + 390, currentY, { width: 86 });
    }
    doc.text("Total", startX + 478, currentY, { width: 45, align: "right" });

    currentY += 13;
    doc.moveTo(startX, currentY).lineTo(startX + pageWidth, currentY).strokeColor("#E2E8F0").stroke();
    currentY += 6;

    // Line Items Rows
    for (let i = 0; i < invoice.lineItems.length; i++) {
      const li = invoice.lineItems[i];
      const sl = li.slNo ?? i + 1;
      const hsn = li.hsnCode ?? "—";
      const uqc = li.uqc ?? li.unit ?? "Unit";
      const taxable = li.taxableAmount ?? li.subtotal;

      const taxRate = typeof li.taxRate === "number" ? li.taxRate : 0;
      let cgstText = "—";
      let sgstText = "—";
      let igstText = "—";

      if (isIntraState) {
        const rateHalf = taxRate > 0 ? (li.cgstRate ?? taxRate / 2) : 0;
        const cgstAmt = li.cgstAmount ?? Math.round((li.taxAmount / 2 + Number.EPSILON) * 100) / 100;
        const sgstAmt = li.sgstAmount ?? Math.round((li.taxAmount - cgstAmt + Number.EPSILON) * 100) / 100;
        cgstText = `${rateHalf}%\n${money(cgstAmt, invoice.currency)}`;
        sgstText = `${rateHalf}%\n${money(sgstAmt, invoice.currency)}`;
      } else {
        const rateFull = li.igstRate ?? taxRate;
        const igstAmt = li.igstAmount ?? li.taxAmount;
        igstText = `${rateFull}%\n${money(igstAmt, invoice.currency)}`;
      }

      const descHeight = doc.heightOfString(li.productName, { width: 170 });
      const rowHeight = Math.max(22, descHeight + 10);

      doc.fontSize(8.5).fillColor("#0f172a");
      doc.text(String(sl), startX, currentY, { width: 18 });
      doc.text(li.productName, startX + 20, currentY, { width: 170 });
      doc.text(hsn, startX + 192, currentY, { width: 40 });
      doc.text(`${li.quantity} ${uqc}`, startX + 234, currentY, { width: 52 });
      doc.text(money(li.unitPrice, invoice.currency), startX + 288, currentY, { width: 48 });
      doc.text(money(taxable, invoice.currency), startX + 338, currentY, { width: 50 });

      if (isIntraState) {
        doc.fontSize(7.5).text(cgstText, startX + 390, currentY, { width: 42 });
        doc.fontSize(7.5).text(sgstText, startX + 434, currentY, { width: 42 });
      } else {
        doc.fontSize(7.5).text(igstText, startX + 390, currentY, { width: 86 });
      }

      doc.fontSize(8.5).text(money(li.total, invoice.currency), startX + 478, currentY, { width: 45, align: "right" });

      currentY += rowHeight;
    }

    doc.moveTo(startX, currentY).lineTo(startX + pageWidth, currentY).strokeColor("#D0D0D0").stroke();
    currentY += 8;

    // Totals Breakdown (Right-Aligned)
    const hasAdjustments =
      invoice.freightChargeAmount !== 0 ||
      invoice.otherChargesAmount !== 0 ||
      invoice.discountAmount !== 0 ||
      invoice.roundingAdjustment !== 0;

    const totalsStartX = startX + 260;
    const totalsWidth = 263;

    doc.fontSize(9).fillColor("#0f172a");
    doc.text(`Subtotal (Assessable Value): ${money(invoice.subtotal, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
    currentY += 12;

    if (hasAdjustments) {
      if (invoice.freightChargeAmount !== 0) {
        doc.text(`Freight Charges (excl. GST): ${money(invoice.freightChargeAmount, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
        currentY += 12;
      }
      if (invoice.otherChargesAmount !== 0) {
        doc.text(`Other Charges (excl. GST): ${money(invoice.otherChargesAmount, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
        currentY += 12;
      }
      if (invoice.discountAmount !== 0) {
        doc.text(`Discount: -${money(invoice.discountAmount, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
        currentY += 12;
      }
      doc.text(`Total Taxable Value: ${money(invoice.taxableValue, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
      currentY += 12;
    }

    // Split Tax Totals
    const totalTax = invoice.taxAmount;
    if (isIntraState) {
      const cgstTot = invoice.cgstAmount ?? Math.round((totalTax / 2 + Number.EPSILON) * 100) / 100;
      const sgstTot = invoice.sgstAmount ?? Math.round((totalTax - cgstTot + Number.EPSILON) * 100) / 100;
      doc.text(`CGST Total: ${money(cgstTot, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
      currentY += 12;
      doc.text(`SGST Total: ${money(sgstTot, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
      currentY += 12;
    } else {
      const igstTot = invoice.igstAmount ?? totalTax;
      doc.text(`IGST Total: ${money(igstTot, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
      currentY += 12;
    }

    if (hasAdjustments && invoice.roundingAdjustment !== 0) {
      doc.text(
        `Rounding: ${invoice.roundingAdjustment > 0 ? "+" : "-"}${money(Math.abs(invoice.roundingAdjustment), invoice.currency)}`,
        totalsStartX,
        currentY,
        { width: totalsWidth, align: "right" }
      );
      currentY += 12;
    }

    doc.fontSize(11).fillColor(OLIVE_ACCENT).text(`Grand Total: ${money(invoice.totalAmount, invoice.currency)}`, totalsStartX, currentY, { width: totalsWidth, align: "right" });
    currentY += 16;

    // Grand Total in Words
    if (invoice.totalInWords) {
      doc.fontSize(8.5).fillColor("#0f172a").text(`Amount in Words: ${invoice.totalInWords}`, startX, currentY, { width: pageWidth });
      currentY += 16;
    }

    doc.moveTo(startX, currentY).lineTo(startX + pageWidth, currentY).strokeColor("#D0D0D0").stroke();
    currentY += 10;

    // Bank Details & Payment Summary Block (2 columns)
    const bank = invoice.bankDetails ?? (BUILDOHUB_COMPANY as any).bankDetails;
    if (bank) {
      doc.fontSize(8.5).fillColor(OLIVE_ACCENT).text("Bank Settlement Details", startX, currentY, { underline: true });
      const acctTypeSuffix = bank.accountType ? ` (${bank.accountType})` : "";
      doc
        .fontSize(8)
        .fillColor("#64748b")
        .text(`Bank: ${bank.bankName} | A/C: ${bank.accountNumber}${acctTypeSuffix}`, startX, currentY + 12)
        .text(`Account Name: ${bank.accountName}`, startX, currentY + 22)
        .text(`IFSC: ${bank.ifscCode} | Branch: ${bank.branch}`, startX, currentY + 32);
    }

    const payX = startX + 320;
    doc.fontSize(8.5).fillColor(OLIVE_ACCENT).text("Payment Summary", payX, currentY, { underline: true });
    doc
      .fontSize(8)
      .fillColor("#64748b")
      .text(`Invoice Amount: ${money(invoice.totalAmount, invoice.currency)}`, payX, currentY + 12)
      .text(`Payment Due By: ${invoice.paymentDueBy ?? "Immediate"}`, payX, currentY + 22);

    currentY += 48;
    doc.moveTo(startX, currentY).lineTo(startX + pageWidth, currentY).strokeColor("#E2E8F0").stroke();
    currentY += 8;

    // Signatory & Declaration Footer
    doc
      .fontSize(7.5)
      .fillColor("#94a3b8")
      .text("Certified that the particulars given above are true and correct.", startX, currentY)
      .text("This is a digitally generated tax invoice issued under Rule 48(4) of the CGST Rules. No physical signature is required.", startX, currentY + 10)
      .text(`For ${BUILDOHUB_COMPANY.legalName} (${BUILDOHUB_COMPANY.name})`, startX + 300, currentY, { width: 223, align: "right" });

    doc.end();
  });
}
