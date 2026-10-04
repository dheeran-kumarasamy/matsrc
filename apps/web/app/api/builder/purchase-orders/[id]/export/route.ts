import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";
import { serializePurchaseOrder, purchaseOrderInclude } from "@/lib/purchase-order-utils";

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

    if (format === "pdf") {
      const buffer = await renderPoPdf(payload);
      // Meaningful filename using the real PO reference already issued
      // for this order (po.poNumber, e.g. "PO-2026-00001") — matches the
      // existing naming convention used elsewhere in the PO flow, rather
      // than inventing a new one.
      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${payload.poNumber}.pdf"`,
        },
      });
    }

    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="${payload.poNumber}.json"`,
      },
    });
  } catch (error) {
    console.error("Purchase order export error:", error);
    return NextResponse.json({ error: "Failed to export purchase order" }, { status: 500 });
  }
}

// C39 fix: generates an actual PDF buffer (replacing the previous HTML
// string that could never be a real downloadable .pdf) using pdfkit — the
// same library/pattern as app/api/builder/orders/[id]/invoice/pdf/route.ts,
// so no second PDF framework is introduced. Renders the identical content
// the old HTML template showed (status, version, buyer/supplier, line
// items, total, notes) from the same serialized PO payload.
function renderPoPdf(po: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(`Purchase Order ${po.poNumber}`);
    doc
      .fontSize(10)
      .fillColor("#64748b")
      .text(`Status: ${po.status} · Version ${po.version}`)
      .text(`Generated: ${new Date(po.generatedAt).toLocaleString("en-IN")}`)
      .text(`Buyer: ${po.builder?.name ?? po.builder?.email ?? "Builder"}`)
      .text(`Supplier: ${po.supplier?.companyName ?? "Supplier"}`)
      .text(`Enquiry/Order ref: ${po.enquiryId ?? po.orderId}`)
      .text(
        po.approvedAt
          ? `Approved: ${new Date(po.approvedAt).toLocaleString("en-IN")} by ${po.approvedBy ?? ""}`
          : "Awaiting approval"
      )
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(12).text("Line Items", { underline: true });
    doc.moveDown(0.3);
    for (const li of po.lineItems) {
      const deliveryLabel = li.deliveryDate ? new Date(li.deliveryDate).toLocaleDateString("en-IN") : "TBD";
      doc
        .fontSize(9)
        .text(
          `${li.productName} — ${li.quantity} ${li.unit ?? ""} x ₹${Number(li.unitPrice).toLocaleString("en-IN")} ` +
            `+ ₹${Number(li.tax).toLocaleString("en-IN")} tax = ₹${Number(li.lineTotal).toLocaleString("en-IN")} ` +
            `(delivery: ${deliveryLabel})`
        );
    }

    doc.moveDown();
    doc.fontSize(12).text(`Total: ₹${Number(po.total).toLocaleString("en-IN")}`, { align: "right" });

    if (po.notes) {
      doc.moveDown();
      doc.fontSize(10).fillColor("#64748b").text(`Notes: ${po.notes}`).fillColor("#0f172a");
    }

    doc.end();
  });
}
