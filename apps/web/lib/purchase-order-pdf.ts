import { PDF_BASE_FONT_BOLD } from "@/lib/pdf-fonts";
import { BUILDOHUB_COMPANY } from "@/lib/company-info";
import { calculateLineGst } from "@matsrc/db";

// Which commercial direction this PDF represents — the two directions
// share every layout/table/pagination detail below and differ ONLY in
// which party is printed as BUYER vs SELLER and which number is printed
// as "the" document number. See the Buyer-Facing/Supplier-Facing PO
// identity fix:
//   - "SUPPLIER" (default, unchanged behaviour): the document BuildOhub
//     issues to the real supplier. BUYER DETAILS = BUILDOHUB_COMPANY,
//     SELLER / SUPPLIER DETAILS = po.supplier (the real supplier). Document
//     number = po.poNumber (PurchaseOrder's own "PO-YYYY-SSSSS" series).
//     Used by apps/supplier's export route and must never change.
//   - "BUYER": the document shown/downloaded by the customer/builder who
//     bought from BuildOhub. BUYER DETAILS = po.builder (the real
//     customer), SELLER DETAILS = BUILDOHUB_COMPANY. Document number =
//     po.orderNumber (the underlying Order's own independent,
//     already-authoritative "OD/YYMM/SSSSS" business number — see
//     packages/db/lib/business-number.ts — falling back to po.poNumber
//     only for pre-payment-approval orders that have not yet been
//     assigned one). Used by apps/web's builder-facing export route.
// Never infer the direction from anything other than this explicit
// parameter — the underlying `po` object is otherwise identical in both
// cases (same PurchaseOrder row), so there is no other reliable signal.
export type PoDocumentMode = "SUPPLIER" | "BUYER";

export type PoPartyBlock = {
  name: string;
  addressLine: string | null;
  gstin: string | null;
  contact: string | null;
};

export type PoDocumentView = {
  documentNumber: string;
  buyer: PoPartyBlock;
  seller: PoPartyBlock;
};

// Pure, pdfkit-free data-mapping helper factored out of renderPoPdfContent
// so the party-mapping/numbering logic (the actual subject of the
// Buyer-Facing/Supplier-Facing PO identity fix) can be unit-tested without
// having to parse rendered PDF bytes. renderPoPdfContent below calls this
// internally for the exact same values it draws onto the page — there is
// no second, divergent code path.
export function resolvePoDocumentView(po: any, mode: PoDocumentMode): PoDocumentView {
  const isBuyerFacing = mode === "BUYER";

  const buildohub: PoPartyBlock = {
    name: BUILDOHUB_COMPANY.name,
    addressLine: BUILDOHUB_COMPANY.addressLine,
    gstin: BUILDOHUB_COMPANY.gstin,
    contact: [BUILDOHUB_COMPANY.email, BUILDOHUB_COMPANY.phone].filter(Boolean).join(" \u00b7 ") || null,
  };

  const supplier: PoPartyBlock = {
    name: po.supplier?.companyName ?? "Supplier",
    addressLine: po.supplier?.addressLine ?? null,
    gstin: po.supplier?.gstin ?? null,
    contact: [po.supplier?.email, po.supplier?.phone].filter(Boolean).join(" \u00b7 ") || null,
  };

  const builder: PoPartyBlock = {
    name: po.builder?.name ?? "Customer",
    addressLine: po.deliverTo?.addressLine ?? null,
    gstin: po.deliverTo?.gstin ?? null,
    contact: [po.builder?.email, po.builder?.phone].filter(Boolean).join(" \u00b7 ") || null,
  };

  return {
    documentNumber: isBuyerFacing ? po.orderNumber ?? po.poNumber : po.poNumber,
    buyer: isBuyerFacing ? builder : buildohub,
    seller: isBuyerFacing ? buildohub : supplier,
  };
}

export type PoDisplayLineItem = {
  quantity: number;
  displayUnitPrice: number;
  displayTax: number;
  displayLineTotal: number;
};

export type PoDisplayTotals = {
  lineItems: PoDisplayLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
};

// Uniform GST on Marked-Up Buyer Price — pure, pdfkit-free computation
// factored out of renderPoPdfContent (same rationale as
// resolvePoDocumentView above) so the actual GST arithmetic — the subject
// of this fix — can be unit-tested directly without parsing rendered PDF
// bytes. renderPoPdfContent below calls this exact function for the values
// it draws onto the page; there is no second, divergent calculation.
//
// SUPPLIER mode (unchanged): GST is taken as-is from each line's
// persisted, supplier-rate-based `tax` (computed at PO-generation time —
// see purchase-order-utils.ts's buildPurchaseOrderLineItemData).
// BUYER mode: GST is recomputed here, at render time, on the marked-up
// buyerUnitPrice via the SAME shared calculateLineGst utility every other
// GST call site in this codebase uses (never a second, parallel
// calculation) — this is the approved "GST on marked-up buyer price"
// policy, matching the buyer Invoice's own treatment for the same order.
export function resolvePoLineItemTotals(po: any, mode: PoDocumentMode): PoDisplayTotals {
  const isBuyerFacing = mode === "BUYER";

  const lineItems = (po.lineItems ?? []).map((li: any) => {
    const displayUnitPrice = isBuyerFacing ? li.buyerUnitPrice ?? li.unitPrice : li.unitPrice;
    const displayTax = isBuyerFacing
      ? calculateLineGst({ quantity: li.quantity, unitPrice: displayUnitPrice, gstRatePercent: li.taxRatePercent }).gstAmount
      : li.tax;
    return {
      quantity: li.quantity,
      displayUnitPrice,
      displayTax,
      displayLineTotal: displayUnitPrice * li.quantity + displayTax,
    };
  });

  const subtotal = lineItems.reduce((acc: number, li: PoDisplayLineItem) => acc + li.displayUnitPrice * li.quantity, 0);
  const taxAmount = lineItems.reduce((acc: number, li: PoDisplayLineItem) => acc + li.displayTax, 0);
  const total = subtotal + taxAmount;

  return { lineItems, subtotal, taxAmount, total };
}

// Draws the full Purchase Order document body onto an already-created
// PDFDocument (see app/api/builder/purchase-orders/[id]/export/route.ts's
// renderPoPdf, which creates the doc, calls useRupeeCapableFont(doc),
// calls this function, then doc.end()s it). Reproduces
// purchase-order-template.xlsx's layout — see renderPoPdf's own header
// comment in the export route for the full reference-fidelity write-up and
// documented departures (no logo, substitute font, deeper accent color for
// readability, and real pagination instead of the reference's fixed 5-row
// spreadsheet area).
//
// `po` is the exact object serializePurchaseOrder() returns. `mode`
// (default "SUPPLIER" to preserve every existing call site's behaviour)
// selects which party is BUYER vs SELLER and which number is printed as
// the document number — see PoDocumentMode above. po.deliverTo is always a
// separate, optional delivery/"ship to" destination regardless of mode —
// see purchase-order-utils.ts's serializePurchaseOrder for how it's
// derived from the order's tagged Site or free-text deliveryAddress.
export function renderPoPdfContent(doc: PDFKit.PDFDocument, po: any, mode: PoDocumentMode = "SUPPLIER"): void {
  const isBuyerFacing = mode === "BUYER";
  // The buyer-facing document is its own commercial record (the customer's
  // order confirmation from BuildOhub) and must never reuse the supplier
  // PO's own number as its identity — see the Order model's independent,
  // atomically-generated orderNumber (OD/YYMM/SSSSS business number).
  // Falls back to poNumber only when an order genuinely has none yet
  // (orderNumber is only assigned once payment is approved — see
  // apps/api's PaymentsService.approve), so a pre-payment PO can still be
  // downloaded/previewed without a blank document number. Computed via the
  // same resolvePoDocumentView() used by the unit tests, so there is no
  // second, divergent definition of "the document number" to drift.
  const { documentNumber } = resolvePoDocumentView(po, mode);
  const ACCENT = "#4A4A4A";
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
    .text(`Purchase order # - ${documentNumber}`, { width: contentWidth, align: "right" });
  doc.fillColor(TEXT);

  let y = doc.y + 10;

  // ---- BUYER DETAILS / SELLER DETAILS ------------------------------
  // SUPPLIER mode (unchanged): BuildOhub is the buyer, the real supplier
  // is the seller. BUYER mode: the real customer (po.builder) is the
  // buyer, BuildOhub is the seller — never the other way round, and never
  // a mix of the two (see PoDocumentMode's doc comment above).
  doc.font(PDF_BASE_FONT_BOLD).fontSize(11).fillColor(ACCENT).text("BUYER DETAILS", colLeftX, y, { width: colWidth });
  doc.text("SELLER / SUPPLIER DETAILS", colRightX, y, { width: colWidth });
  y = doc.y + 4;

  doc.font("PDFBaseFont").fontSize(10).fillColor(TEXT);

  const buildohubBlock = [
    BUILDOHUB_COMPANY.name,
    // Registered parent company name — shown directly under the trading
    // name so the GSTIN/address below are unambiguously tied to the legal
    // entity that holds them (Triad Build Tech Private Limited).
    BUILDOHUB_COMPANY.legalName,
    BUILDOHUB_COMPANY.addressLine ? addressLines(BUILDOHUB_COMPANY) : "Registered address: Not configured",
    BUILDOHUB_COMPANY.gstin ? `GSTIN: ${BUILDOHUB_COMPANY.gstin}` : "GSTIN: Not configured",
    [BUILDOHUB_COMPANY.email, BUILDOHUB_COMPANY.phone].filter(Boolean).join(" \u00b7 ") || null,
  ].filter(Boolean) as string[];

  const supplierBlock = [
    po.supplier?.companyName ?? "Supplier",
    addressLines(po.supplier ?? {}) || null,
    po.supplier?.region ? `Region: ${po.supplier.region}` : null,
    po.supplier?.gstin ? `GSTIN: ${po.supplier.gstin}` : "GSTIN: Not available",
    [po.supplier?.email, po.supplier?.phone].filter(Boolean).join(" \u00b7 ") || null,
  ].filter(Boolean) as string[];

  // The real customer/builder has no registered-address or GSTIN fields in
  // the schema today (see User model) — falls back to the order's own
  // deliverTo/ship-to address (the closest authoritative address on file)
  // and an explicit "Not configured" GSTIN label, mirroring BUILDOHUB_
  // COMPANY's own documented fallback for the same genuine data gap,
  // rather than fabricating a registered address.
  const builderAddress = po.deliverTo ? addressLines(po.deliverTo) : null;
  const builderBlock = [
    po.builder?.name ?? "Customer",
    builderAddress || "Registered address: Not configured",
    po.deliverTo?.gstin ? `GSTIN: ${po.deliverTo.gstin}` : "GSTIN: Not configured",
    [po.builder?.email, po.builder?.phone].filter(Boolean).join(" \u00b7 ") || null,
  ].filter(Boolean) as string[];

  const buyerBlock = isBuyerFacing ? builderBlock : buildohubBlock;
  const sellerBlock = isBuyerFacing ? buildohubBlock : supplierBlock;

  doc.text(buyerBlock.join("\n"), colLeftX, y, { width: colWidth });
  const buyerBottom = doc.y;

  doc.font("PDFBaseFont").fontSize(10).fillColor(TEXT);
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
  // SR.NO | Item description | Qty | Rate | GST% | Amount — same base
  // column order as the reference's row 19 header (B/C/E/F/G; the
  // reference's blank D column was pure spreadsheet spacing, not a
  // distinct field), with an additional GST% column so the tax rate
  // applied to each line is always shown explicitly, never folded
  // silently into Amount.
  const colSr = tableLeft;
  const colSrW = 30;
  const colDesc = colSr + colSrW;
  const colDescW = tableWidth * 0.33;
  const colQty = colDesc + colDescW;
  const colQtyW = tableWidth * 0.1;
  const colRate = colQty + colQtyW;
  const colRateW = tableWidth * 0.16;
  const colGstRate = colRate + colRateW;
  const colGstRateW = tableWidth * 0.11;
  const colAmount = colGstRate + colGstRateW;
  const colAmountW = tableWidth - colSrW - colDescW - colQtyW - colRateW - colGstRateW;

  // Formats a line item's GST rate as an explicit percentage label (e.g.
  // "18%"), or "—" for pre-migration rows that have no stored rate (see
  // PurchaseOrderLineItem.taxRatePercent's doc comment) — never a
  // fabricated rate.
  function gstRateLabel(li: any): string {
    return typeof li.taxRatePercent === "number" ? `${li.taxRatePercent}%` : "\u2014";
  }

  function drawTableHeader(headerY: number): number {
    doc.font(PDF_BASE_FONT_BOLD).fontSize(9).fillColor(ACCENT);
    doc.text("SR.NO", colSr, headerY, { width: colSrW });
    doc.text("ITEM DESCRIPTION", colDesc, headerY, { width: colDescW });
    doc.text("QTY", colQty, headerY, { width: colQtyW, align: "right" });
    doc.text("RATE", colRate, headerY, { width: colRateW, align: "right" });
    doc.text("GST %", colGstRate, headerY, { width: colGstRateW, align: "right" });
    doc.text("AMOUNT", colAmount, headerY, { width: colAmountW, align: "right" });
    doc.fillColor(TEXT);
    const headerBottom = headerY + 16;
    doc.moveTo(tableLeft, headerBottom).lineTo(tableLeft + tableWidth, headerBottom).strokeColor(ACCENT).lineWidth(1).stroke();
    return headerBottom + 6;
  }

  const pageBottom = doc.page.height - doc.page.margins.bottom;
  y = drawTableHeader(y);

  // Uniform GST on Marked-Up Buyer Price (approved policy): GST must be
  // calculated once, on the applicable GST-taxable value — the BUYER-mode
  // document's taxable value is the marked-up buyer price
  // (li.buyerUnitPrice), never the original supplier rate (li.unitPrice).
  // SUPPLIER mode (unchanged): uses the persisted, supplier-rate-based
  // `li.tax` as-is. See resolvePoLineItemTotals's own doc comment for the
  // full rationale — this mirrors the already-approved treatment
  // InvoicesService.generate() applies to the buyer Invoice, so the PO and
  // the eventual Invoice for the same order reconcile to the same basis.
  const computedTotals = resolvePoLineItemTotals(po, mode);
  const displayLineItems = po.lineItems.map((li: any, index: number) => ({
    ...li,
    displayUnitPrice: computedTotals.lineItems[index].displayUnitPrice,
    displayTax: computedTotals.lineItems[index].displayTax,
    displayLineTotal: computedTotals.lineItems[index].displayLineTotal,
  }));
  const displaySubtotal = computedTotals.subtotal;
  const displayTaxAmount = computedTotals.taxAmount;
  const displayTotal = computedTotals.total;

  displayLineItems.forEach((li: any, index: number) => {
    // Estimate row height from the description's wrapped line count so
    // long descriptions never overlap the next row.
    //
    // BUG FIX: this previously measured ONLY li.productName, but the text
    // actually rendered below is `li.productName + " (unit)"` — a trailing
    // word pdfkit may wrap onto an extra line that the height estimate
    // never accounted for, understating rowHeight and letting the next
    // row (and its zebra-stripe background) start drawing before the
    // current row's wrapped description had finished, visually merging
    // the two rows together. Measuring the exact same string that gets
    // rendered (and the same font/size — fontSize(9) below) eliminates
    // that mismatch.
    const descriptionText = li.productName + (li.unit ? ` (${li.unit})` : "");
    doc.font("PDFBaseFont").fontSize(9);
    const descHeight = doc.heightOfString(descriptionText, { width: colDescW });
    // Extra vertical padding (14, up from 6) between wrapped description
    // text and the next row's top edge/zebra-stripe band, so dense
    // multi-line descriptions never visually crowd or merge into the row
    // below even if the height estimate is off by a point or two.
    const rowHeight = Math.max(22, descHeight + 14);

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
    doc.text(descriptionText, colDesc, y, { width: colDescW });
    doc.text(String(li.quantity), colQty, y, { width: colQtyW, align: "right" });
    doc.text(money(li.displayUnitPrice), colRate, y, { width: colRateW, align: "right" });
    doc.text(gstRateLabel(li), colGstRate, y, { width: colGstRateW, align: "right" });
    doc.text(money(li.displayLineTotal), colAmount, y, { width: colAmountW, align: "right" });

    y += rowHeight;
  });

  y += 4;
  doc.moveTo(tableLeft, y).lineTo(tableLeft + tableWidth, y).strokeColor("#D0D0D0").lineWidth(0.5).stroke();
  y += 10;

  // ---- Explicit Subtotal / GST / Total breakdown ---------------------
  // Previously a single orange TOTAL band folded tax silently into the
  // grand total with no visible calculation. Now shows the taxable value
  // (Subtotal), the GST amount actually applied (explicitly labelled with
  // the rate when every line shares one, since that is by far the common
  // case — a PO with mixed per-line rates still shows the correct total
  // GST amount, just without a single "@X%" suffix that could misstate a
  // mixed-rate PO), and the grand Total — mirroring the Invoice PDF's own
  // Subtotal/Tax/Total structure.
  const summaryLabelX = colQty;
  const summaryValueX = colAmount;

  const distinctRates = Array.from(
    new Set(po.lineItems.map((li: any) => (typeof li.taxRatePercent === "number" ? li.taxRatePercent : null)))
  );
  const uniformRate = distinctRates.length === 1 ? distinctRates[0] : null;
  const gstLabel = uniformRate !== null ? `GST @ ${uniformRate}%` : "GST";

  if (y + 70 > pageBottom) {
    doc.addPage();
    y = marginLeft;
  }

  // Uniform GST on Marked-Up Buyer Price: the Subtotal/GST/Total band now
  // shows a real, reconciled figure in BOTH modes — BUYER mode's
  // displaySubtotal/displayTaxAmount/displayTotal (computed alongside
  // displayLineItems above) are GST calculated on the marked-up buyer
  // value via the shared calculateLineGst utility, matching the buyer
  // Invoice's own treatment for the same order.
  doc.font("PDFBaseFont").fontSize(10).fillColor(TEXT);
  doc.text("Subtotal (Taxable Value)", summaryLabelX, y, {
    width: colQtyW + colRateW,
  });
  doc.text(money(displaySubtotal), summaryValueX, y, { width: colAmountW, align: "right" });
  y += 16;

  doc.text(gstLabel, summaryLabelX, y, {
    width: colQtyW + colRateW,
  });
  doc.text(money(displayTaxAmount), summaryValueX, y, {
    width: colAmountW,
    align: "right",
  });
  y += 20;

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
    .text("TOTAL", colDesc, y + 6, { width: colQtyW + colRateW + colGstRateW });
  doc.text(money(displayTotal), colAmount, y + 6, { width: colAmountW, align: "right" });
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
