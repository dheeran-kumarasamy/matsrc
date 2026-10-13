import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";
import { serializePurchaseOrder, purchaseOrderInclude } from "@/lib/purchase-order-utils";
import { useRupeeCapableFont } from "@/lib/pdf-fonts";
import { renderPoPdfContent, type PoDocumentMode } from "@/lib/purchase-order-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/builder/purchase-orders/[id]/export
// Auto-generates a downloadable JSON representation of the PO for record-keeping.
// Kept async/on-demand (only computed when requested) so it never blocks the approval flow.
//
// C39 fix: ?format=pdf previously returned a print-ready HTML document with
// `Content-Disposition: inline`. The browser has no PDF renderer for
// text/html, so it always opened that HTML in a new tab instead of ever
// downloading a .pdf file — "Download PO (PDF)" never actually produced a
// PDF. This now reuses the same pdfkit library already used by the
// equivalent builder invoice PDF endpoint
// (app/api/builder/orders/[id]/invoice/pdf/route.ts) to generate a real PDF
// buffer, served with `application/pdf` + `Content-Disposition: attachment`
// so the browser downloads it directly rather than opening a tab.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: purchaseOrderInclude,
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const payload = {
      documentType: "PURCHASE_ORDER",
      generatedAt: new Date().toISOString(),
      ...serializePurchaseOrder(po),
    };

    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    // Buyer-Facing/Supplier-Facing PO Identity fix: this route is the
    // CUSTOMER/builder-portal download of their own order from BuildOhub —
    // the builder must be shown as BUYER and BuildOhub as SELLER (never the
    // reverse, which this previously got wrong by unconditionally reusing
    // the supplier-facing rendering), and the printed document number must
    // be the Order's own independent, already-authoritative orderNumber
    // (OD/YYMM/SSSSS) rather than the separate PurchaseOrder.poNumber series
    // reused by the supplier-facing document (see
    // apps/supplier/app/api/supplier/purchase-orders/[id]/export/route.ts,
    // which keeps the original "SUPPLIER" mode/poNumber behaviour
    // unchanged). Falls back to poNumber for the filename only when an
    // order genuinely has no orderNumber yet (pre-payment-approval).
    const documentNumber = payload.orderNumber ?? payload.poNumber;

    if (format === "pdf") {
      const buffer = await renderPoPdf(payload);
      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${documentNumber}.pdf"`,
        },
      });
    }

    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="${documentNumber}.json"`,
      },
    });
  } catch (error: any) {
    // This endpoint is hit via a plain <a href> download link (not a
    // fetch()-based builderApi* call), so resolveUserCtx() falls back to
    // the NextAuth session cookie (see lib/builder-db.ts) and throws
    // "UNAUTHENTICATED" if that session check fails (expired/missing
    // cookie). Every other route using resolveUserCtx()/getUserCtx() maps
    // this to a clean 401 — this route was missing that check entirely and
    // fell through to a generic 500, which is what surfaced in production
    // as "GET .../export?format=pdf 500 (Internal Server Error)".
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Purchase order export error:", error);
    return NextResponse.json({ error: "Failed to export purchase order" }, { status: 500 });
  }
}

// Renders the supplier-facing Purchase Order PDF, reproducing the layout
// structure of the attached purchase-order-template.xlsx design reference
// (inspected cell-by-cell with openpyxl) as closely as reasonably possible
// in pdfkit:
//   - Right-aligned "PURCHASE ORDER" heading + "Purchase order# - <PO>"
//     beneath it, mirroring the reference's F3/F4 cells.
//   - A left "BUYER DETAILS" block and a right "SELLER / SUPPLIER
//     DETAILS" block placed side-by-side, per the reference's layout.
//   - A shaded "DELIVER TO" band (reference's row-9 #F9F9F9 fill) with
//     Order date / Delivery date on the right (reference's B9/F9/G9).
//   - A line-item table: SR.NO / Item description / Qty / Rate / Amount
//     (reference's row 19 header, same column order), alternating row
//     shading (reference's #D9D9D9/#FFFFFF banding).
//   - An orange Total band (reference's #F66E3D row 33) and a Notes
//     footer (reference's row 39 "Notes" heading).
//
// Deliberate, documented departures from the reference:
//   - No logo — required by the task, and the reference itself has none.
//   - Font: DejaVu Sans (regular/bold) instead of the reference's
//     Trebuchet MS/Arial, which don't ship with this server runtime;
//     DejaVu Sans is already embedded everywhere in this app so the ₹
//     glyph renders (see lib/pdf-fonts.ts) and is a metrically similar
//     sans-serif.
//   - Accent color #C8532A (slightly deeper than the reference's #F66E3D)
//     and near-black body text instead of the reference's pale #8A8A8A,
//     for print/screen readability (task's explicit readability
//     requirement).
//   - Pagination: the reference is a fixed single-page spreadsheet with a
//     hard-coded 5-row item area; this renderer paginates and repeats the
//     table header for any number of line items, since a real PO can have
//     more rows than the reference's fixed spreadsheet layout allows.
// Always rendered in "BUYER" mode — see renderPoPdfContent's PoDocumentMode
// doc comment: this route is the customer/builder's own download, so the
// builder is shown as BUYER and BuildOhub as SELLER, printing the Order's
// own orderNumber as the document number (never the PurchaseOrder's
// poNumber, which remains the supplier-facing document's own, separate
// identifier — see apps/supplier's equivalent route, which still renders
// in the original "SUPPLIER" mode).
const DOCUMENT_MODE: PoDocumentMode = "BUYER";

function renderPoPdf(po: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    useRupeeCapableFont(doc);

    renderPoPdfContent(doc, po, DOCUMENT_MODE);

    doc.end();
  });
}
