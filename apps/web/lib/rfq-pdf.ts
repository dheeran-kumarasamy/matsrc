import PDFDocument from "pdfkit";
import { PDF_BASE_FONT, PDF_BASE_FONT_BOLD, useRupeeCapableFont } from "@/lib/pdf-fonts";
import { BUILDOHUB_COMPANY } from "@/lib/company-info";

// Download RFQ as PDF — Builder Portal.
//
// Renders a "Request for Quotation" document for a single Order (the
// authoritative RFQ record in this codebase — builder enquiries, not the
// legacy QuickRequest table). Structurally mirrors
// apps/api/src/common/rfq-pdf.util.ts's identical renderer (kept
// duplicated per this repo's existing convention of not sharing
// pdfkit-rendering code across app boundaries — see
// apps/web/lib/company-info.ts's own header comment for the same
// rationale) — any change to one should be mirrored in the other two
// (apps/api, apps/supplier) so all three portals produce the same
// document.
//
// Deliberately NEVER includes: SupplierQuote-level pricing/notes, payment
// information, purchase-order data, or internal database ids — this is a
// pre-quotation REQUEST document, not a commercial/financial one.
export type RfqPdfLineItem = {
  productName: string;
  description: string | null;
  quantity: number;
  unit: string;
};

export type RfqPdfData = {
  rfqNumber: string;
  createdAt: string | Date;
  status: string;
  // Identity privacy: neither party's real name/contact details are ever
  // part of this document — a builder must never learn which supplier(s)
  // were asked to quote, and a supplier must never learn the builder's
  // real identity. The requesting party is represented ONLY by its
  // construction Site name (never the builder's own name/email/phone),
  // and the counterparty is always rendered as "BuildOhub" (see
  // BUILDOHUB_COMPANY below) regardless of which real supplier/builder is
  // actually involved. There is deliberately no `builder`/`supplier`
  // identity field on this type at all, so no caller can accidentally
  // wire real contact details into the rendered document.
  site: {
    name: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  deliveryAddress: string | null;
  deliveryDate: string | Date | null;
  // RFQ-level notes/terms where the authoritative record actually has them
  // — deliberately never populated from SupplierQuote.notes (a specific
  // supplier's own quotation remarks, not a neutral RFQ-level note).
  notes: string | null;
  lineItems: RfqPdfLineItem[];
};

const ACCENT = "#4A4A4A";
const TEXT = "#0f172a";
const MUTED = "#6B6B6B";

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "\u2014";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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

/**
 * Renders the RFQ PDF body onto an already-created PDFDocument (caller
 * creates the doc, calls useRupeeCapableFont(doc), calls this, then
 * doc.end()s it) — mirrors purchase-order-pdf.ts's renderPoPdfContent split
 * between document lifecycle (route) and content drawing (this function),
 * so it is directly unit-testable without a network round-trip.
 */
export function renderRfqPdfContent(doc: PDFKit.PDFDocument, data: RfqPdfData): void {
  const marginLeft = doc.page.margins.left;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const contentWidth = doc.page.width - marginLeft - doc.page.margins.right;

  // ---- Header ---------------------------------------------------------
  doc.font(PDF_BASE_FONT_BOLD).fontSize(20).fillColor(ACCENT).text("Request for Quotation", marginLeft, marginLeft, {
    width: contentWidth,
    align: "right",
  });
  doc
    .font(PDF_BASE_FONT)
    .fontSize(10)
    .fillColor(MUTED)
    .text(`RFQ # ${data.rfqNumber}`, { width: contentWidth, align: "right" })
    .text(`Date: ${formatDate(data.createdAt)}`, { width: contentWidth, align: "right" })
    .text(`Status: ${data.status}`, { width: contentWidth, align: "right" });
  doc.fillColor(TEXT);

  let y = doc.y + 14;

  // ---- Requested By (Site only) / Supplier (always BuildOhub) blocks ----
  // Identity privacy: the requester is identified ONLY by its construction
  // Site name (never the builder's own name/email/phone), and the
  // counterparty is always shown as "BuildOhub" — neither the builder nor
  // the supplier ever sees the other's real identity through this
  // document. See RfqPdfData's own doc comment for the full rationale.
  const colWidth = contentWidth / 2 - 10;
  const colRightX = marginLeft + colWidth + 20;

  doc.font(PDF_BASE_FONT_BOLD).fontSize(11).fillColor(ACCENT).text("Requested By", marginLeft, y, { width: colWidth });
  doc.text("Supplier", colRightX, y, { width: colWidth });
  y = doc.y + 4;

  doc.font(PDF_BASE_FONT).fontSize(10).fillColor(TEXT);
  doc.text(data.site?.name ?? "Site not specified", marginLeft, y, { width: colWidth });
  const leftBottom = doc.y;

  doc.font(PDF_BASE_FONT).fontSize(10).fillColor(TEXT);
  doc.text(BUILDOHUB_COMPANY.name, colRightX, y, { width: colWidth });
  const rightBottom = doc.y;

  y = Math.max(leftBottom, rightBottom) + 16;

  // ---- Site / Delivery --------------------------------------------------
  if (y + 60 > pageBottom) {
    doc.addPage();
    y = marginLeft;
  }

  doc.font(PDF_BASE_FONT_BOLD).fontSize(11).fillColor(ACCENT).text("Delivery", marginLeft, y, { width: contentWidth });
  y = doc.y + 4;
  doc.font(PDF_BASE_FONT).fontSize(10).fillColor(TEXT);

  const deliveryLines: string[] = [];
  if (data.site) {
    deliveryLines.push(data.site.name);
    const siteAddress = addressLines(data.site);
    if (siteAddress) deliveryLines.push(siteAddress);
  } else if (data.deliveryAddress) {
    deliveryLines.push(data.deliveryAddress);
  } else {
    deliveryLines.push("Not specified");
  }
  deliveryLines.push(`Requested delivery date: ${formatDate(data.deliveryDate)}`);

  doc.text(deliveryLines.join("\n"), marginLeft, y, { width: contentWidth });
  y = doc.y + 16;

  // ---- Line items table -------------------------------------------------
  const colSr = marginLeft;
  const colSrW = 30;
  const colDesc = colSr + colSrW;
  const colDescW = contentWidth * 0.55;
  const colQty = colDesc + colDescW;
  const colQtyW = contentWidth * 0.2;
  const colUnit = colQty + colQtyW;
  const colUnitW = contentWidth - colSrW - colDescW - colQtyW;

  const drawTableHeader = () => {
    doc.font(PDF_BASE_FONT_BOLD).fontSize(10).fillColor(ACCENT);
    doc.text("#", colSr, y, { width: colSrW });
    doc.text("Product / Specification", colDesc, y, { width: colDescW });
    doc.text("Quantity", colQty, y, { width: colQtyW, align: "right" });
    doc.text("Unit", colUnit, y, { width: colUnitW, align: "right" });
    doc.fillColor(TEXT);
    y += 16;
    doc
      .moveTo(marginLeft, y)
      .lineTo(marginLeft + contentWidth, y)
      .strokeColor("#D0D0D0")
      .stroke();
    y += 6;
  };

  if (y + 40 > pageBottom) {
    doc.addPage();
    y = marginLeft;
  }
  doc.font(PDF_BASE_FONT_BOLD).fontSize(12).fillColor(ACCENT).text("Requested Items", marginLeft, y, { width: contentWidth });
  y = doc.y + 6;
  drawTableHeader();

  doc.font(PDF_BASE_FONT).fontSize(9).fillColor(TEXT);
  for (let i = 0; i < data.lineItems.length; i++) {
    const li = data.lineItems[i];
    const descriptionText = li.description ? `${li.productName} \u2014 ${li.description}` : li.productName;
    const descHeight = doc.heightOfString(descriptionText, { width: colDescW });
    const rowHeight = Math.max(18, descHeight + 8);

    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = marginLeft;
      drawTableHeader();
      doc.font(PDF_BASE_FONT).fontSize(9).fillColor(TEXT);
    }

    doc.text(String(i + 1), colSr, y, { width: colSrW });
    doc.text(descriptionText, colDesc, y, { width: colDescW });
    doc.text(String(li.quantity), colQty, y, { width: colQtyW, align: "right" });
    doc.text(li.unit, colUnit, y, { width: colUnitW, align: "right" });

    y += rowHeight;
  }

  y += 6;
  doc
    .moveTo(marginLeft, y)
    .lineTo(marginLeft + contentWidth, y)
    .strokeColor("#D0D0D0")
    .stroke();
  y += 14;

  // ---- Notes footer -------------------------------------------------
  if (data.notes) {
    if (y + 40 > pageBottom) {
      doc.addPage();
      y = marginLeft;
    }
    doc.font(PDF_BASE_FONT_BOLD).fontSize(11).fillColor(ACCENT).text("Notes", marginLeft, y, { width: contentWidth });
    doc.font(PDF_BASE_FONT).fontSize(9).fillColor(TEXT).text(data.notes, marginLeft, doc.y + 4, { width: contentWidth });
  }

  // ---- Page numbering ---------------------------------------------------
  // Final pass across every page already created (see renderRfqPdf below,
  // which creates the document with `bufferPages: true` for exactly this
  // reason) — mirrors the standard pdfkit page-numbering recipe.
  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
    doc.switchToPage(i);
    doc
      .font(PDF_BASE_FONT)
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Page ${i + 1} of ${pageRange.count}`, marginLeft, doc.page.height - doc.page.margins.bottom + 10, {
        width: contentWidth,
        align: "center",
      });
    doc.text(`Generated via ${BUILDOHUB_COMPANY.name}`, marginLeft, doc.page.height - doc.page.margins.bottom + 22, {
      width: contentWidth,
      align: "center",
    });
  }
  doc.fillColor(TEXT);
}

/**
 * Creates a fresh A4 PDFDocument, registers the rupee-capable font, draws
 * the RFQ content via renderRfqPdfContent, and resolves with the complete
 * PDF buffer.
 */
export function renderRfqPdf(data: RfqPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    useRupeeCapableFont(doc);

    renderRfqPdfContent(doc, data);

    doc.end();
  });
}
