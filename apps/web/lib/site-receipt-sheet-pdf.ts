import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "@/lib/pdf-fonts";
import { BUILDOHUB_COMPANY } from "@/lib/company-info";
import type { SiteReceiptSheetData } from "./site-receipt-sheet-dto";

// Re-export type for convenience
export type { SiteReceiptSheetData } from "./site-receipt-sheet-dto";

const OLIVE_ACCENT = "#4A4A4A";

/**
 * Renders a clean, professional, A4 printable Site Material Receipt & Verification Sheet PDF.
 *
 * STRICT PRIVACY REQUIREMENT:
 * This generator receives only sanitized SiteReceiptSheetData containing NO commercial,
 * tax, rate, or pricing information. It generates a document specifically meant for site
 * engineers to physically inspect and record deliveries.
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
      // Header Left: Platform Identity
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
          66
        )
        .text(`Phone: ${BUILDOHUB_COMPANY.phone} | Email: ${BUILDOHUB_COMPANY.email}`, startX, 78);

      // Header Right: Document Title & Metadata
      doc
        .fontSize(11)
        .fillColor(OLIVE_ACCENT)
        .text(data.documentTitle, startX + 220, 36, { width: 303, align: "right" });

      doc
        .fontSize(8.5)
        .fillColor("#0f172a")
        .text(`Sheet No: ${data.receiptSheetNumber}`, startX + 220, 52, { width: 303, align: "right" })
        .fillColor("#64748b")
        .text(`Ref Invoice: ${data.invoiceNumber}`, startX + 220, 64, { width: 303, align: "right" })
        .text(
          `Date: ${new Date(data.invoiceDate).toLocaleDateString("en-IN")}${data.buyerPoNumber ? ` | PO: ${data.buyerPoNumber}` : ""}`,
          startX + 220,
          76,
          { width: 303, align: "right" }
        );

      doc.moveTo(startX, 94).lineTo(startX + pageWidth, 94).strokeColor("#D0D0D0").stroke();
    }

    // Draw primary header
    drawHeader();

    // 2-Column Site & Project Details Grid
    const partyY = 104;
    const colWidth = 250;

    // Left Column: Buyer & Site Information
    doc.fontSize(9.5).fillColor(OLIVE_ACCENT).text("BUYER / PROJECT DETAILS", startX, partyY, { underline: true });
    doc.fontSize(9).fillColor("#0f172a");
    const buyerNameH = doc.heightOfString(data.buyerName, { width: colWidth });
    doc.text(data.buyerName, startX, partyY + 14, { width: colWidth });

    doc.fillColor("#64748b");
    const siteTitleY = partyY + 14 + buyerNameH + 2;
    doc.text(`Site: ${data.siteName}`, startX, siteTitleY, { width: colWidth });
    const siteTitleH = doc.heightOfString(`Site: ${data.siteName}`, { width: colWidth });

    const addrY = siteTitleY + siteTitleH + 2;
    const addrText = `Delivery Address: ${data.deliveryAddress}`;
    const addrH = doc.heightOfString(addrText, { width: colWidth });
    doc.text(addrText, startX, addrY, { width: colWidth });
    const leftBottom = addrY + addrH;

    // Right Column: Delivery & Reference Details
    const rightColX = startX + 273;
    doc.fontSize(9.5).fillColor(OLIVE_ACCENT).text("DELIVERY & REFERENCE", rightColX, partyY, { underline: true });
    doc.fontSize(9).fillColor("#0f172a");
    const supplierH = doc.heightOfString(`Supplier: ${data.supplierName}`, { width: colWidth });
    doc.text(`Supplier: ${data.supplierName}`, rightColX, partyY + 14, { width: colWidth });

    doc.fillColor("#64748b");
    const orderRefY = partyY + 14 + supplierH + 2;
    doc.text(`Enquiry / Order Ref: ${data.orderReference}`, rightColX, orderRefY, { width: colWidth });
    const orderRefH = doc.heightOfString(`Enquiry / Order Ref: ${data.orderReference}`, { width: colWidth });

    const genDateY = orderRefY + orderRefH + 2;
    const genDateText = `Issued On: ${new Date(data.generatedDate).toLocaleDateString("en-IN")}`;
    doc.text(genDateText, rightColX, genDateY, { width: colWidth });
    const rightBottom = genDateY + 14;

    let currentY = Math.max(leftBottom, rightBottom) + 10;
    doc.moveTo(startX, currentY).lineTo(startX + pageWidth, currentY).strokeColor("#D0D0D0").stroke();
    currentY += 10;

    // Table Column Definitions
    // Total width = 523
    // S.No: 26, Material / Description: 167, Spec: 80, Unit: 45, Inv Qty: 45, Recv: 40, Acc: 40, Rej: 40, Remarks: 40
    const colX = {
      sl: startX,
      product: startX + 24,
      spec: startX + 185,
      unit: startX + 265,
      invQty: startX + 305,
      recvQty: startX + 350,
      accQty: startX + 395,
      rejQty: startX + 440,
      remarks: startX + 480,
    };

    function drawTableHeader(y: number) {
      doc.rect(startX, y, pageWidth, 22).fillColor("#F8FAFC").fill();
      doc.rect(startX, y, pageWidth, 22).strokeColor("#CBD5E1").stroke();

      doc.fontSize(7.5).fillColor("#334155");
      doc.text("S.No", colX.sl + 2, y + 6, { width: 20, align: "center" });
      doc.text("Material / Description", colX.product + 2, y + 6, { width: 155, align: "left" });
      doc.text("Spec / Code", colX.spec + 2, y + 6, { width: 75, align: "left" });
      doc.text("Unit", colX.unit + 2, y + 6, { width: 36, align: "center" });
      doc.text("Inv Qty", colX.invQty + 2, y + 6, { width: 40, align: "right" });
      doc.text("Recv Qty", colX.recvQty + 2, y + 6, { width: 40, align: "center" });
      doc.text("Acc Qty", colX.accQty + 2, y + 6, { width: 40, align: "center" });
      doc.text("Rej Qty", colX.rejQty + 2, y + 6, { width: 38, align: "center" });
      doc.text("Remarks", colX.remarks + 2, y + 6, { width: 40, align: "center" });

      return y + 22;
    }

    currentY = drawTableHeader(currentY);

    // Render Table Line Items
    for (const item of data.items) {
      const prodText = item.description ? `${item.productName}\n${item.description}` : item.productName;
      const prodH = doc.heightOfString(prodText, { width: 155 });
      const rowHeight = Math.max(prodH + 8, 24);

      // Check for page break inside table
      if (currentY + rowHeight > pageBottomLimit) {
        doc.addPage();
        drawHeader();
        currentY = 104;
        currentY = drawTableHeader(currentY);
      }

      // Alternate row background
      doc.rect(startX, currentY, pageWidth, rowHeight).strokeColor("#E2E8F0").stroke();

      doc.fontSize(8).fillColor("#0f172a");
      doc.text(String(item.slNo), colX.sl + 2, currentY + 4, { width: 20, align: "center" });
      doc.text(item.productName, colX.product + 2, currentY + 4, { width: 155 });
      if (item.description) {
        doc.fontSize(7).fillColor("#64748b").text(item.description, colX.product + 2, currentY + 14, { width: 155 });
      }

      doc.fontSize(7.5).fillColor("#475569");
      doc.text(item.specification || "-", colX.spec + 2, currentY + 4, { width: 75 });
      doc.text(item.unit, colX.unit + 2, currentY + 4, { width: 36, align: "center" });

      // Reference Invoice Quantity
      doc.fontSize(8).fillColor("#0f172a").text(
        item.invoiceQuantity.toLocaleString("en-IN", { maximumFractionDigits: 3 }),
        colX.invQty + 2,
        currentY + 4,
        { width: 40, align: "right" }
      );

      // Manual Entry Verification Boxes for Site Engineer
      doc.rect(colX.recvQty + 4, currentY + 3, 36, rowHeight - 6).strokeColor("#CBD5E1").stroke();
      doc.rect(colX.accQty + 4, currentY + 3, 36, rowHeight - 6).strokeColor("#CBD5E1").stroke();
      doc.rect(colX.rejQty + 3, currentY + 3, 36, rowHeight - 6).strokeColor("#CBD5E1").stroke();
      doc.rect(colX.remarks + 3, currentY + 3, 38, rowHeight - 6).strokeColor("#CBD5E1").stroke();

      currentY += rowHeight;
    }

    currentY += 12;

    // Check if verification checklist and signature section fits on current page
    const verificationSectionHeight = 160;
    if (currentY + verificationSectionHeight > pageBottomLimit) {
      doc.addPage();
      drawHeader();
      currentY = 104;
    }

    // Material Verification Checklist Section
    doc.rect(startX, currentY, pageWidth, 74).fillColor("#F8FAFC").fill();
    doc.rect(startX, currentY, pageWidth, 74).strokeColor("#CBD5E1").stroke();

    doc.fontSize(9).fillColor(OLIVE_ACCENT).text("MATERIAL VERIFICATION & INSPECTION CHECKLIST", startX + 10, currentY + 8, {
      underline: true,
    });

    const checkY1 = currentY + 24;
    const checkY2 = currentY + 42;

    // Row 1
    doc.rect(startX + 12, checkY1, 10, 10).strokeColor("#475569").stroke();
    doc.fontSize(8).fillColor("#334155").text("All materials received as listed", startX + 28, checkY1 + 1);

    doc.rect(startX + 180, checkY1, 10, 10).strokeColor("#475569").stroke();
    doc.text("Quantity discrepancy identified", startX + 196, checkY1 + 1);

    doc.rect(startX + 355, checkY1, 10, 10).strokeColor("#475569").stroke();
    doc.text("Damaged materials identified", startX + 371, checkY1 + 1);

    // Row 2
    doc.rect(startX + 12, checkY2, 10, 10).strokeColor("#475569").stroke();
    doc.text("Product / spec mismatch", startX + 28, checkY2 + 1);

    doc.rect(startX + 180, checkY2, 10, 10).strokeColor("#475569").stroke();
    doc.text("Partial delivery / Balance pending", startX + 196, checkY2 + 1);

    doc.rect(startX + 355, checkY2, 10, 10).strokeColor("#475569").stroke();
    doc.text("Other (see remarks below)", startX + 371, checkY2 + 1);

    currentY += 86;

    // Signatures & Remarks Area
    const signBoxWidth = (pageWidth - 12) / 2;

    // Left: Site Engineer / Receiver
    doc.rect(startX, currentY, signBoxWidth, 68).strokeColor("#CBD5E1").stroke();
    doc.fontSize(8.5).fillColor("#0f172a").text("VERIFIED & RECEIVED BY (SITE ENGINEER)", startX + 8, currentY + 6);
    doc.fontSize(7.5).fillColor("#64748b");
    doc.text("Name: ___________________________________", startX + 8, currentY + 22);
    doc.text("Signature: ______________________________", startX + 8, currentY + 36);
    doc.text("Date: _______________  Time: ____________", startX + 8, currentY + 50);

    // Right: Transporter / Delivery Representative
    const rightSignX = startX + signBoxWidth + 12;
    doc.rect(rightSignX, currentY, signBoxWidth, 68).strokeColor("#CBD5E1").stroke();
    doc.fontSize(8.5).fillColor("#0f172a").text("DELIVERED BY (DRIVER / TRANSPORTER)", rightSignX + 8, currentY + 6);
    doc.fontSize(7.5).fillColor("#64748b");
    doc.text("Name: ___________________________________", rightSignX + 8, currentY + 22);
    doc.text("Vehicle No: _____________________________", rightSignX + 8, currentY + 36);
    doc.text("Signature: ______________________________", rightSignX + 8, currentY + 50);

    currentY += 76;

    // Footer on all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = 792 - 36; // 841.89 - 50 -> 792 pt
      doc.moveTo(startX, footerY - 6).lineTo(startX + pageWidth, footerY - 6).strokeColor("#E2E8F0").stroke();
      doc
        .fontSize(7)
        .fillColor("#64748b")
        .text(
          "This document is intended solely for material delivery verification at the construction site. It contains no commercial or payment information.",
          startX,
          footerY,
          { width: pageWidth - 70, align: "left" }
        );
      doc.text(`Page ${i + 1} of ${range.count}`, startX + pageWidth - 60, footerY, {
        width: 60,
        align: "right",
      });
    }

    doc.end();
  });
}

