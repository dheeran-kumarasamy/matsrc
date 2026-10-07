import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";
import { resolveSupplierOrderReference } from "@/lib/order-display";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/supplier/purchase-orders/[id]/export?format=pdf|json
//
// Supplier-portal-native equivalent of apps/web's
// /api/builder/purchase-orders/[id]/export. The two apps are separate
// Vercel deployables on separate domains (buildohub.in vs the supplier
// portal's own origin) with completely separate auth — a supplier session
// can never satisfy the builder app's `builderId` ownership check, and a
// bare relative `/api/builder/...` href resolves against the CURRENT
// origin, so a supplier clicking "Download PO (PDF)" from this portal was
// hitting a route that doesn't exist here at all, surfacing as a 404.
// This route exists so the supplier portal's own "Download PO (PDF)" link
// (see getSupplierPurchaseOrderDetail's exportUrl /
// getSupplierOrderDetail's purchaseOrder.exportUrl) is same-origin and
// authorized against the supplier's own session (supplierId ownership —
// mirrors getSupplierPurchaseOrderDetail's existing `where` clause), never
// the builder's.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { supplierProfile } = await ensureSupplierContext(email);

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, supplierId: supplierProfile.id },
      include: {
        supplier: true,
        builder: true,
        lineItems: { include: { product: true } },
        order: { select: { enquiryId: true, orderNumber: true } },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const payload = serializeForExport(po);

    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    if (format === "pdf") {
      const buffer = await renderPoPdf(payload);
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
    console.error("Supplier purchase order export error:", error);
    return NextResponse.json({ error: "Failed to export purchase order" }, { status: 500 });
  }
}

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

// Mirrors apps/web/lib/purchase-order-utils.ts's serializePurchaseOrder shape
// closely enough for renderPoPdf below, using the S15 canonical
// supplier-facing order reference instead of the builder's enquiryId.
function serializeForExport(po: any) {
  const lineItems = po.lineItems.map((li: any) => ({
    id: li.id,
    productName: li.product.name,
    unit: li.product.unit,
    quantity: li.quantity,
    unitPrice: toNumber(li.unitPrice),
    tax: toNumber(li.tax),
    deliveryDate: li.deliveryDate,
    fulfilledQuantity: li.fulfilledQuantity,
    lineTotal: toNumber(li.unitPrice) * li.quantity + toNumber(li.tax),
  }));

  return {
    documentType: "PURCHASE_ORDER",
    generatedAt: new Date().toISOString(),
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    version: po.version,
    notes: po.notes,
    approvedAt: po.approvedAt,
    approvedBy: po.approvedBy,
    orderId: po.orderId,
    enquiryId: resolveSupplierOrderReference(po.order ?? {}),
    supplier: { id: po.supplier.id, companyName: po.supplier.companyName },
    builder: { id: po.builder.id, name: po.builder.name, email: po.builder.email },
    lineItems,
    total: lineItems.reduce((acc: number, li: any) => acc + li.lineTotal, 0),
  };
}

// Byte-for-byte the same rendering logic as apps/web's
// app/api/builder/purchase-orders/[id]/export/route.ts renderPoPdf — kept
// duplicated (not shared via packages/db) because pdfkit requires the
// Node.js runtime and each app already duplicates small, framework-adjacent
// render/notify helpers this way (see e.g. notifySupplierOrderSubmitted vs
// apps/supplier's own notify helpers) rather than forcing a shared package
// to carry a rendering dependency only two of several apps need.
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
      .text(`Status: ${po.status} \u00b7 Version ${po.version}`)
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
          `${li.productName} \u2014 ${li.quantity} ${li.unit ?? ""} x \u20b9${Number(li.unitPrice).toLocaleString("en-IN")} ` +
            `+ \u20b9${Number(li.tax).toLocaleString("en-IN")} tax = \u20b9${Number(li.lineTotal).toLocaleString("en-IN")} ` +
            `(delivery: ${deliveryLabel})`
        );
    }

    doc.moveDown();
    doc.fontSize(12).text(`Total: \u20b9${Number(po.total).toLocaleString("en-IN")}`, { align: "right" });

    if (po.notes) {
      doc.moveDown();
      doc.fontSize(10).fillColor("#64748b").text(`Notes: ${po.notes}`).fillColor("#0f172a");
    }

    doc.end();
  });
}
