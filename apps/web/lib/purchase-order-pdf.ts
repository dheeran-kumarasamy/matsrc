import { PDF_BASE_FONT_BOLD } from "@/lib/pdf-fonts";
import { BUILDOHUB_COMPANY } from "@/lib/company-info";

// Draws the full supplier-facing Purchase Order document body onto an
// already-created PDFDocument (see app/api/builder/purchase-orders/[id]/
// export/route.ts's renderPoPdf, which creates the doc, calls
// useRupeeCapableFont(doc), calls this function, then doc.end()s it).
// Reproduces purchase-order-template.xlsx's layout — see renderPoPdf's own
// header comment in the export route for the full reference-fidelity
// write-up and documented departures (no logo, substitute font, deeper
// accent color for readability, and real pagination instead of the
// reference's fixed 5-row spreadsheet area).
//
// `po` is the exact object serializePurchaseOrder() returns, with BUYER
// DETAILS always sourced from BUILDOHUB_COMPANY (never po.builder — the
// end customer must never be shown as the party purchasing from the
// supplier) and SELLER DETAILS always sourced from po.supplier (the real
// supplier, never BuildOhub). po.deliverTo is a separate, optional
// delivery/"ship to" destination — see purchase-order-utils.ts's
// serializePurchaseOrder for how it's derived from the order's tagged
// Site or free-text deliveryAddress.
export function renderPoPdfContent(doc: PDFKit.PDFDocument, po: any): void {
  const ACCENT = "#C8532A";
  const TEXT = "#1A1A1A";
  const MUTED = "#5A5A5A";
  const BAND_LIGHT = "#F9F9F9";
  const ROW_ALT = "#EFEFEF";

  const pageWidth = doc.page.width;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const colLeftX = marginLeft;
  const colRightX = marginLeft + contentWidth / 2 + 10;
  const colWidth = contentWidth / 2 - 10;

  function money(value: number): string {
    return `\u20B9${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  }

  function addressLines(party: {
    addressLine?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  }): string {
    return [party.addressLine, [party.city, party.state].filter(Boolean).join(", "), party.pincode]
      .filter(Boolean)
      .join("\n");
  }

  // ---- Header: title (right) -------------------------------------
  doc.font(PDF_BASE_FONT_BOLD).fontSize(20).fillColor(ACCENT).text("PURCHASE ORDER", colLeftX, marginLeft, {
    width: contentWidth,
    align: "right",
  });
  doc
    .font("PDFBaseFont")
    .fontSize(10)
    .fillColor(MUTED)
    .text(`Purchase order # - ${po.poNumber}`, { width: contentWidth, align: "right" });
  doc.fillColor(TEXT);

  let y = doc.y + 10;

  // ---- BUYER DETAILS (BuildOhub) / SELLER DETAILS (supplier) ------
  doc.font(PDF_BASE_FONT_BOLD).fontSize(11).fillColor(ACCENT).text("BUYER DETAILS", colLeftX, y, { width: colWidth });
  doc.text("SELLER / SUPPLIER DETAILS", colRightX, y, { width: colWidth });
  y = doc.y + 4;

  doc.font("PDFBaseFont").fontSize(10).fillColor(TEXT);
  const buyerBlock = [
    BUILDOHUB_COMPANY.name,
    BUILDOHUB_COMPANY.addressLine ? addressLines(BUILDOHUB_COMPANY) : "Registered address: Not configured",
    BUILDOHUB_COMPANY.gstin ? `GSTIN: ${BUILDOHUB_COMPANY.gstin}` : "GSTIN: Not configured",
    [BUILDOHUB_COMPANY.email, BUILDOHUB_COMPANY.phone].filter(Boolean).join(" \u00b7 ") || null,
  ].filter(Boolean) as string[];
  doc.text(buyerBlock.join("\n"), colLeftX, y, { width: colWidth });
  const buyerBottom = doc.y;

  const sellerAddress = addressLines(po.supplier ?? {});
  const sellerBlock = [
    po.supplier?.companyName ?? "Supplier",
    sellerAddress || null,
    po.supplier?.region ? `Region: ${po.supplier.region}` : null,
    po.supplier?.gstin ? `GSTIN: ${po.supplier.gstin}` : "GSTIN: Not available",
    [po.supplier?.email, po.supplier?.phone].filter(Boolean).join(" \u00b7 ") || null,
  ].filter(Boolean) as string[];
  doc.text(sellerBlock.join("\n"), colRightX, y, { width: colWidth });
  const sellerBottom = doc.y;

  y = Math.max(buyerBottom, sellerBottom) + 14;

  // ---- DELIVER TO band (shaded) + Order/Delivery dates ------------
  const bandHeight = 70;
  doc.rect(marginLeft, y, contentWidth, bandHeight).fill(BAND_LIGHT);
  doc.fillColor(TEXT);

  const bandPadding = 10;
  doc
    .font(PDF_BASE_FONT_BOLD)
    .fontSize(10)
    .fillColor(ACCENT)
    .text("DELIVER TO", colLeftX + bandPadding, y + bandPadding, { width: colWidth });
  doc.font("PDFBaseFont").fontSize(9).fillColor(TEXT);
  const deliverTo = po.deliverTo;
  const deliverToBlock = deliverTo
    ? ([deliverTo.name, addressLines(deliverTo), deliverTo.gstin ? `GSTIN: ${deliverTo.gstin}` : null].filter(
        Boolean
      ) as string[])
    : ["Delivery address not recorded for this order"];
  doc.text(deliverToBlock.join("\n"), colLeftX + bandPadding, doc.y + 2, { width: colWidth - bandPadding });

  const orderDate = po.createdAt ? new Date(po.createdAt) : null;
  const firstDeliveryDate = po.lineItems?.find((li: any) => li.deliveryDate)?.deliveryDate ?? null;

  let dateY = y + bandPadding;
  doc.font(PDF_BASE_FONT_BOLD).fontSize(9).fillColor(ACCENT).text("Order date:", colRightX, dateY, {
    width: colWidth - bandPadding,
    align: "right",
  });
  doc
    .font("PDFBaseFont")
    .fillColor(MUTED)
    .text(orderDate ? orderDate.toLocaleDateString("en-IN") : "-", colRightX, doc.y, {
      width: colWidth - bandPadding,
      align: "right",
    });
  dateY = doc.y + 6;
  doc.font(PDF_BASE_FONT_BOLD).fillColor(ACCENT).text("Delivery date:", colRightX, dateY, {
    width: colWidth - bandPadding,
    align: "right",
  });
  doc
    .font("PDFBaseFont")
    .fillColor(MUTED)
    .text(firstDeliveryDate ? new Date(firstDeliveryDate).toLocaleDateString("en-IN") : "TBD", colRightX, doc.y, {
      width: colWidth - bandPadding,
      align: "right",
    });
  doc.fillColor(TEXT);

  y = y + bandHeight + 16;

  // ---- Order reference / status line -------------------------------
  doc
    .font("PDFBaseFont")
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      `Order ref: ${po.orderNumber ?? po.enquiryId ?? po.orderId} \u00b7 Status: ${po.status} \u00b7 Version ${po.version}` +
        (po.approvedAt ? ` \u00b7 Approved ${new Date(po.approvedAt).toLocaleDateString("en-IN")}` : ""),
      colLeftX,
      y,
      { width: contentWidth }
    )
    .fillColor(TEXT);
  y = doc.y + 14;

  // ---- Line-item table ---------------------------------------------
  const tableLeft = marginLeft;
  const tableWidth = contentWidth;
  // SR.NO | Item description | Qty | Rate | Amount — same column order as
  // the reference's row 19 header (B/C/E/F/G); the reference's blank D
  // column was pure spreadsheet spacing, not a distinct field.
  const colSr = tableLeft;
  const colSrW = 35;
  const colDesc = colSr + colSrW;
  const colDescW = tableWidth * 0.4;
  const colQty = colDesc + colDescW;
  const colQtyW = tableWidth * 0.12;
  const colRate = colQty + colQtyW;
  const colRateW = tableWidth * 0.2;
  const colAmount = colRate + colRateW;
  const colAmountW = tableWidth - colSrW - colDescW - colQtyW - colRateW;

  function drawTableHeader(headerY: number): number {
    doc.font(PDF_BASE_FONT_BOLD).fontSize(9).fillColor(ACCENT);
    doc.text("SR.NO", colSr, headerY, { width: colSrW });
    doc.text("ITEM DESCRIPTION", colDesc, headerY, { width: colDescW });
    doc.text("QTY", colQty, headerY, { width: colQtyW, align: "right" });
    doc.text("RATE", colRate, headerY, { width: colRateW, align: "right" });
    doc.text("AMOUNT", colAmount, headerY, { width: colAmountW, align: "right" });
    doc.fillColor(TEXT);
    const headerBottom = headerY + 16;
    doc.moveTo(tableLeft, headerBottom).lineTo(tableLeft + tableWidth, headerBottom).strokeColor(ACCENT).lineWidth(1).stroke();
    return headerBottom + 6;
  }

  const pageBottom = doc.page.height - doc.page.margins.bottom;
  y = drawTableHeader(y);

  po.lineItems.forEach((li: any, index: number) => {
    // Estimate row height from the description's wrapped line count so
    // long descriptions never overlap the next row.
    doc.font("PDFBaseFont").fontSize(9);
    const descHeight = doc.heightOfString(li.productName, { width: colDescW });
    const rowHeight = Math.max(18, descHeight + 6);

    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = marginLeft;
      y = drawTableHeader(y);
    }

    if (index % 2 === 1) {
      doc.rect(tableLeft, y - 2, tableWidth, rowHeight).fill(ROW_ALT);
      doc.fillColor(TEXT);
    }

    doc.font("PDFBaseFont").fontSize(9).fillColor(TEXT);
    doc.text(String(index + 1), colSr, y, { width: colSrW });
    doc.text(li.productName + (li.unit ? ` (${li.unit})` : ""), colDesc, y, { width: colDescW });
    doc.text(String(li.quantity), colQty, y, { width: colQtyW, align: "right" });
    doc.text(money(li.unitPrice), colRate, y, { width: colRateW, align: "right" });
    doc.text(money(li.lineTotal), colAmount, y, { width: colAmountW, align: "right" });

    y += rowHeight;
  });

  y += 4;
  doc.moveTo(tableLeft, y).lineTo(tableLeft + tableWidth, y).strokeColor("#D0D0D0").lineWidth(0.5).stroke();
  y += 10;

  // ---- Total band (orange, reference's row-33 styling) --------------
  if (y + 28 > pageBottom) {
    doc.addPage();
    y = marginLeft;
  }
  const totalBandHeight = 26;
  doc.rect(tableLeft, y, tableWidth, totalBandHeight).fill(ACCENT);
  doc
    .font(PDF_BASE_FONT_BOLD)
    .fontSize(11)
    .fillColor("#FFFFFF")
    .text("TOTAL", colDesc, y + 6, { width: colQtyW + colRateW });
  doc.text(money(po.total), colAmount, y + 6, { width: colAmountW, align: "right" });
  doc.fillColor(TEXT);
  y += totalBandHeight + 20;

  // ---- Notes footer ---------------------------------------------
  if (po.notes) {
    if (y + 40 > pageBottom) {
      doc.addPage();
      y = marginLeft;
    }
    doc.font(PDF_BASE_FONT_BOLD).fontSize(11).fillColor(ACCENT).text("Notes", tableLeft, y);
    doc.font("PDFBaseFont").fontSize(9).fillColor(TEXT).text(po.notes, tableLeft, doc.y + 4, { width: tableWidth });
  }
}
