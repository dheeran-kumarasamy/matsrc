import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "src/common/pdf-fonts";
import { BUILDOHUB_COMPANY } from "src/common/company-info";

// Download RFQ as PDF — Admin, Supplier and Builder Portals.
//
// Renders a "Request for Quotation" document for a single Order (the
// authoritative RFQ record in this codebase — see the feature's Phase 1
// investigation report for why Order/OrderItem, not the legacy
// QuickRequest table, is the correct source). Built from a plain,
// pdfkit-free RfqPdfData shape so the same rendering logic is trivially
// unit-testable without parsing rendered PDF bytes, and so the three portal
// apps (apps/api/Admin, apps/web/Builder, apps/supplier/Supplier) can each
// build their own RfqPdfData from their own Prisma query shape and get an
// identical document.
//
// Deliberately NEVER includes: SupplierQuote-level pricing/notes, payment
// information, purchase-order data, or internal database ids — this is a
// pre-quotation REQUEST document, not a commercial/financial one. See the
// doc comment on `notes` below.
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
  builder: { name: string | null; email: string | null; phone: string | null } | null;
  site: {
    name: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  // Only populated once a supplier has actually been assigned/selected for
  // this RFQ (see OrderItem.supplier) — never fabricated, and never a
  // competing supplier's identity.
  supplier: { companyName: string; email: string | null; phone: string | null } | null;
  deliveryAddress: string | null;
  deliveryDate: string | Date | null;
  // RFQ-level notes/terms, where the authoritative record actually has
  // them (e.g. legacy QuickRequest.notes). Deliberately NEVER populated
  // from SupplierQuote.notes — those are a specific supplier's own
  // quotation remarks, not a neutral RFQ-level note meant for every
  // recipient of this document.
  notes: string | null;
  lineItems: RfqPdfLineItem[];
};

const ACCENT = "#A8AE8A";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BASE_FONT = "PDFBaseFont";

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
 * doc.end()s it) — mirrors renderInvoicePdf's/renderPoPdfContent's existing
 * split between "create+finish the document" (left to the caller/route)
 * and "draw the content" (this function), so it can be unit tested
 * directly against a real pdfkit document without a network round-trip.
 *
 * apps/api's pdf-fonts.ts registers only one weight (PDFBaseFont, no bold
 * variant) — emphasis here uses fontSize/fillColor only, mirroring
 * invoice-pdf.util.ts's own identical convention (that file never switches
 * to a bold font either).
 */
export function renderRfqPdfContent(doc: PDFKit.PDFDocument, data: RfqPdfData): void {
  const marginLeft = doc.page.margins.left;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const contentWidth = doc.page.width - marginLeft - doc.page.margins.right;

  // ---- Header ---------------------------------------------------------
  doc.font(BASE_FONT).fontSize(20).fillColor(ACCENT).text("Request for Quotation", marginLeft, marginLeft, {
    width: contentWidth,
    align: "right",
  });
  doc
    .fontSize(10)
    .fillColor(MUTED)
    .text(`RFQ # ${data.rfqNumber}`, { width: contentWidth, align: "right" })
    .text(`Date: ${formatDate(data.createdAt)}`, { width: contentWidth, align: "right" })
    .text(`Status: ${data.status}`, { width: contentWidth, align: "right" });
  doc.fillColor(TEXT);

  let y = doc.y + 14;

  // ---- Builder / Supplier party blocks ---------------------------------
  const colWidth = contentWidth / 2 - 10;
  const colRightX = marginLeft + colWidth + 20;

  doc.fontSize(11).fillColor(ACCENT).text("Requested By", marginLeft, y, { width: colWidth });
  doc.text("Supplier", colRightX, y, { width: colWidth });
  y = doc.y + 4;

  doc.fontSize(10).fillColor(TEXT);
  const builderBlock = [
    data.builder?.name ?? "Builder",
    [data.builder?.email, data.builder?.phone].filter(Boolean).join(" \u00b7 ") || null,
  ].filter(Boolean) as string[];
  doc.text(builderBlock.join("\n"), marginLeft, y, { width: colWidth });
  const leftBottom = doc.y;

  doc.fontSize(10).fillColor(TEXT);
  const supplierBlock = data.supplier
    ? ([
        data.supplier.companyName,
        [data.supplier.email, data.supplier.phone].filter(Boolean).join(" \u00b7 ") || null,
      ].filter(Boolean) as string[])
    : ["Not yet assigned"];
  doc.text(supplierBlock.join("\n"), colRightX, y, { width: colWidth });
  const rightBottom = doc.y;

  y = Math.max(leftBottom, rightBottom) + 16;

  // ---- Site / Delivery --------------------------------------------------
  if (y + 60 > pageBottom) {
    doc.addPage();
    y = marginLeft;
  }

  doc.fontSize(11).fillColor(ACCENT).text("Delivery", marginLeft, y, { width: contentWidth });
  y = doc.y + 4;
  doc.fontSize(10).fillColor(TEXT);

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
    doc.fontSize(10).fillColor(ACCENT);
    doc.text("#", colSr, y, { width: colSrW });
    doc.text("Product / Specification", colDesc, y, { width: colDescW });
    doc.text("Quantity", colQty, y, { width: colQtyW, align: "right" });
    doc.text("Unit", colUnit, y, { width: colUnitW, align: "right" });
    doc.fillColor(TEXT);
    y += 16;
    doc
      .moveTo(marginLeft, y)
      .lineTo(marginLeft + contentWidth, y)
      .strokeColor("#e2e8f0")
      .stroke();
    y += 6;
  };

  if (y + 40 > pageBottom) {
    doc.addPage();
    y = marginLeft;
  }
  doc.fontSize(12).fillColor(ACCENT).text("Requested Items", marginLeft, y, { width: contentWidth });
  y = doc.y + 6;
  drawTableHeader();

  doc.fontSize(9).fillColor(TEXT);
  for (let i = 0; i < data.lineItems.length; i++) {
    const li = data.lineItems[i];
    const descriptionText = li.description ? `${li.productName} \u2014 ${li.description}` : li.productName;
    const descHeight = doc.heightOfString(descriptionText, { width: colDescW });
    const rowHeight = Math.max(18, descHeight + 8);

    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = marginLeft;
      drawTableHeader();
      doc.fontSize(9).fillColor(TEXT);
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
    .strokeColor("#e2e8f0")
    .stroke();
  y += 14;

  // ---- Notes footer -------------------------------------------------
  if (data.notes) {
    if (y + 40 > pageBottom) {
      doc.addPage();
      y = marginLeft;
    }
    doc.fontSize(11).fillColor(ACCENT).text("Notes", marginLeft, y, { width: contentWidth });
    doc.fontSize(9).fillColor(TEXT).text(data.notes, marginLeft, doc.y + 4, { width: contentWidth });
  }

  // ---- Page numbering ---------------------------------------------------
  // Drawn as a final pass across every page already created above (rather
  // than per-page as content is drawn), using pdfkit's bufferPages mode —
  // mirrors the standard pdfkit page-numbering recipe and avoids any
  // interaction with the mid-page addPage() calls used for pagination
  // above. The caller (renderRfqPdf below) creates the document with
  // `bufferPages: true` for exactly this reason.
  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
    doc.switchToPage(i);
    doc
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
 * PDF buffer. `bufferPages: true` lets renderRfqPdfContent go back and
 * stamp "Page X of N" on every page after all content (and therefore the
 * true final page count) is known.
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
