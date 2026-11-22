import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "@/lib/pdf-fonts";
import { BUILDOHUB_COMPANY } from "@/lib/company-info";
import type { SiteReceiptSheetData, DeliveryChallanData, DeliveryChallanItem } from "./site-receipt-sheet-dto";

// Re-export types for convenience
export type { SiteReceiptSheetData, DeliveryChallanData, DeliveryChallanItem } from "./site-receipt-sheet-dto";

const OLIVE_ACCENT = "#4A4A4A";

/**
 * Renders a clean, professional, A4 printable Delivery Challan (DC) PDF.
 *
 * STRICT PRIVACY REQUIREMENT:
 * This generator receives only sanitized SiteReceiptSheetData containing NO commercial,
 * tax, rate, or pricing information.
 */
export function renderSiteReceiptSheetPdf(data: SiteReceiptSheetData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      bufferPages: true,
      autoFirstPage: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    useRupeeCapableFont(doc);

    const startX = 36;
    const pageWidth = 523; // 595.28 - 72
    const pageBottomLimit = 750;

    // Helper to draw standard header
    function drawHeader() {
      // Header Left: Platform Identity (Company name, legal name, registered address)
      doc.fontSize(14).fillColor("#0f172a").text(BUILDOHUB_COMPANY.name, startX, 36);
      doc
        .fontSize(8.5)
        .fillColor("#64748b")
        .text(BUILDOHUB_COMPANY.legalName, startX, 54)
        .text(
          [BUILDOHUB_COMPANY.addressLine, BUILDOHUB_COMPANY.city, BUILDOHUB_COMPANY.state, BUILDOHUB_COMPANY.pincode]
            .filter(Boolean)
            .join(", "),
          startX,
          66,
          { width: 250 }
        );

      // Header Right: Document Title & Metadata
      doc
        .fontSize(14)
        .fillColor(OLIVE_ACCENT)
        .text("DELIVERY CHALLAN", startX + 220, 36, { width: 303, align: "right" });

      doc
        .fontSize(9)
        .fillColor("#0f172a")
        .text(data.receiptSheetNumber, startX + 220, 54, { width: 303, align: "right" });

      doc
        .fontSize(8.5)
        .fillColor("#64748b")
        .text(`Ref Invoice: ${data.invoiceNumber}`, startX + 220, 68, { width: 303, align: "right" })
        .text(
          `Date: ${new Date(data.invoiceDate).toLocaleDateString("en-IN")}${data.buyerPoNumber ? ` | PO: ${data.buyerPoNumber}` : ""}`,
          startX + 220,
          80,
          { width: 303, align: "right" }
        );

      doc.moveTo(startX, 98).lineTo(startX + pageWidth, 98).strokeColor("#D0D0D0").stroke();
    }

    // Draw primary header
    drawHeader();

    // 2-Column Parties Grid: Buyer Details (Left) vs Site Details (Right)
    const partyY = 108;
    const colWidth = 250;

    // Left Column: Buyer Details (Full Buyer Legal/Trade Name and Billing Address; GSTIN explicitly omitted)
    doc.fontSize(10).fillColor(OLIVE_ACCENT).text("BUYER DETAILS", startX, partyY, { underline: true });
    doc.fontSize(9).fillColor("#0f172a");
    const buyerNameH = doc.heightOfString(data.buyerName, { width: colWidth });
    doc.text(data.buyerName, startX, partyY + 14, { width: colWidth });

    doc.fillColor("#64748b");
    const buyerAddrY = partyY + 14 + buyerNameH + 2;
    const buyerAddrText = `Address: ${data.buyerAddress}`;
    const buyerAddrH = doc.heightOfString(buyerAddrText, { width: colWidth });
    doc.text(buyerAddrText, startX, buyerAddrY, { width: colWidth });
    const leftBottom = buyerAddrY + buyerAddrH;

    // Right Column: Site Details (Site Name and Address; State code omitted)
    const siteX = startX + 273;
    doc.fontSize(10).fillColor(OLIVE_ACCENT).text("DELIVERY SITE DETAILS", siteX, partyY, { underline: true });
    doc.fontSize(9).fillColor("#0f172a");
    const siteNameH = doc.heightOfString(data.siteName, { width: colWidth });
    doc.text(data.siteName, siteX, partyY + 14, { width: colWidth });

    doc.fillColor("#64748b");
    const siteAddrY = partyY + 14 + siteNameH + 2;
    const siteAddrText = `Address: ${data.siteAddress}`;
    const siteAddrH = doc.heightOfString(siteAddrText, { width: colWidth });
    doc.text(siteAddrText, siteX, siteAddrY, { width: colWidth });
    const rightBottom = siteAddrY + siteAddrH;

    let currentY = Math.max(leftBottom, rightBottom) + 12;
    doc.moveTo(startX, currentY).lineTo(startX + pageWidth, currentY).strokeColor("#D0D0D0").stroke();
    currentY += 10;

    // Table Column Definitions
    // Total width = 523
    // S.No: 30, Material / Description: 243, Spec / Code: 110, Unit: 60, Qty: 80
    const colX = {
      sl: startX,
      product: startX + 30,
      spec: startX + 275,
      unit: startX + 385,
      qty: startX + 445,
    };

    function drawTableHeader(y: number) {
      doc.rect(startX, y, pageWidth, 22).fillColor("#F8FAFC").fill();
      doc.rect(startX, y, pageWidth, 22).strokeColor("#CBD5E1").stroke();

      doc.fontSize(8.5).fillColor("#334155");
      doc.text("S.No", colX.sl + 4, y + 6, { width: 22, align: "center" });
      doc.text("Material / Description", colX.product + 4, y + 6, { width: 235, align: "left" });
      doc.text("Specification / Code", colX.spec + 4, y + 6, { width: 100, align: "left" });
      doc.text("Unit", colX.unit + 4, y + 6, { width: 50, align: "center" });
      doc.text("Quantity", colX.qty + 4, y + 6, { width: 70, align: "right" });

      return y + 22;
    }

    currentY = drawTableHeader(currentY);

    // Render Table Line Items
    for (const item of data.items) {
      const prodText = item.description ? `${item.productName}\n${item.description}` : item.productName;
      const prodH = doc.heightOfString(prodText, { width: 235 });
      const rowHeight = Math.max(prodH + 10, 26);

      // Check for page break inside table
      if (currentY + rowHeight > pageBottomLimit) {
        doc.addPage();
        drawHeader();
        currentY = 108;
        currentY = drawTableHeader(currentY);
      }

      // Row border
      doc.rect(startX, currentY, pageWidth, rowHeight).strokeColor("#E2E8F0").stroke();

      doc.fontSize(8.5).fillColor("#0f172a");
      doc.text(String(item.slNo), colX.sl + 4, currentY + 6, { width: 22, align: "center" });
      doc.text(item.productName, colX.product + 4, currentY + 6, { width: 235 });
      if (item.description) {
        doc.fontSize(7.5).fillColor("#64748b").text(item.description, colX.product + 4, currentY + 18, { width: 235 });
      }

      doc.fontSize(8).fillColor("#475569");
      doc.text(item.specification || "-", colX.spec + 4, currentY + 6, { width: 100 });
      doc.text(item.unit, colX.unit + 4, currentY + 6, { width: 50, align: "center" });

      // Clean, clear Quantity column
      doc.fontSize(8.5).fillColor("#0f172a").text(
        item.invoiceQuantity.toLocaleString("en-IN", { maximumFractionDigits: 3 }),
        colX.qty + 4,
        currentY + 6,
        { width: 70, align: "right" }
      );

      currentY += rowHeight;
    }

    // Page numbering in footer
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = 792 - 36;
      doc.moveTo(startX, footerY - 6).lineTo(startX + pageWidth, footerY - 6).strokeColor("#E2E8F0").stroke();
      doc.fontSize(8).fillColor("#64748b").text(`Page ${i + 1} of ${range.count}`, startX, footerY, {
        width: pageWidth,
        align: "right",
      });
    }

    doc.end();
  });
}

export const renderDeliveryChallanPdf = renderSiteReceiptSheetPdf;
