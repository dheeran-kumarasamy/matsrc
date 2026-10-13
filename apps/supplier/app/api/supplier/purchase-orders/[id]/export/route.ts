import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";
import { resolveSupplierOrderReference } from "@/lib/order-display";
import { useRupeeCapableFont } from "@/lib/pdf-fonts";
import { renderPoPdfContent, type PoDocumentMode } from "@/lib/purchase-order-pdf";

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
        supplier: { include: { user: { select: { email: true, phone: true } } } },
        builder: true,
        lineItems: { include: { product: true } },
        order: {
          select: {
            enquiryId: true,
            orderNumber: true,
            deliveryAddress: true,
            site: {
              select: { name: true, addressLine: true, city: true, state: true, pincode: true, gstin: true },
            },
          },
        },
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
    // The GST rate (percentage) used to compute `tax` above — null only
    // for pre-migration line items created before this column existed
    // (see PurchaseOrderLineItem's doc comment in schema.prisma); the PDF
    // must show a generic "Tax" label for those rather than fabricating
    // a rate.
    taxRatePercent: li.taxRatePercent !== null && li.taxRatePercent !== undefined ? toNumber(li.taxRatePercent) : null,
    deliveryDate: li.deliveryDate,
    fulfilledQuantity: li.fulfilledQuantity,
    lineTotal: toNumber(li.unitPrice) * li.quantity + toNumber(li.tax),
  }));

  // The order's delivery/"ship to" destination — see apps/web's
  // purchase-order-utils.ts's serializePurchaseOrder for the identical
  // derivation (tagged Site, falling back to the order's free-text
  // deliveryAddress). Always kept separate from BUYER DETAILS
  // (BuildOhub) — the delivery recipient is the builder's construction
  // site, never the purchasing party.
  const deliverTo = po.order?.site
    ? {
        name: po.order.site.name,
        addressLine: po.order.site.addressLine ?? null,
        city: po.order.site.city ?? null,
        state: po.order.site.state ?? null,
        pincode: po.order.site.pincode ?? null,
        gstin: po.order.site.gstin ?? null,
      }
    : po.order?.deliveryAddress
      ? { name: null, addressLine: po.order.deliveryAddress, city: null, state: null, pincode: null, gstin: null }
      : null;

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
    createdAt: po.createdAt,
    orderId: po.orderId,
    enquiryId: resolveSupplierOrderReference(po.order ?? {}),
    orderNumber: po.order?.orderNumber ?? null,
    // SELLER / SUPPLIER DETAILS on the PDF — the real supplier fulfilling
    // this PO, never BuildOhub. BUYER DETAILS is rendered separately by
    // renderPoPdfContent from BUILDOHUB_COMPANY, never from `builder`
    // below (the end customer, who must never be shown as purchasing
    // directly from the supplier).
    supplier: {
      id: po.supplier.id,
      companyName: po.supplier.companyName,
      gstin: po.supplier.gstin ?? null,
      region: po.supplier.region ?? null,
      email: po.supplier.user?.email ?? null,
      phone: po.supplier.user?.phone ?? null,
    },
    builder: { id: po.builder.id, name: po.builder.name, email: po.builder.email },
    deliverTo,
    lineItems,
    // Explicit subtotal/GST breakdown — mirrors the Invoice's own
    // subtotal/taxAmount so the PO PDF can show the same
    // "Subtotal + GST = Total" structure instead of folding tax silently
    // into a single Total figure.
    subtotal: lineItems.reduce((acc: number, li: any) => acc + li.unitPrice * li.quantity, 0),
    taxAmount: lineItems.reduce((acc: number, li: any) => acc + li.tax, 0),
    total: lineItems.reduce((acc: number, li: any) => acc + li.lineTotal, 0),
  };
}

// Renders the supplier-facing Purchase Order PDF via the shared
// renderPoPdfContent (see lib/purchase-order-pdf.ts for the full
// reference-fidelity write-up — reproduces purchase-order-template.xlsx's
// layout: BUYER DETAILS = BuildOhub, SELLER / SUPPLIER DETAILS = this
// route's `supplier` field, a separate shaded DELIVER TO band, the
// SR.NO/Item description/Qty/Rate/Amount line-item table, and the orange
// Total band). Byte-for-byte the same rendering logic as apps/web's
// app/api/builder/purchase-orders/[id]/export/route.ts (both import their
// own per-app copy of lib/purchase-order-pdf.ts) — kept duplicated per-app
// rather than shared via packages/db, since pdfkit requires the Node.js
// runtime and each app already duplicates small, framework-adjacent
// render/notify helpers this way (see e.g. notifySupplierOrderSubmitted vs
// apps/supplier's own notify helpers) rather than forcing a shared package
// to carry a rendering dependency only two of several apps need.
// Explicitly "SUPPLIER" mode (the default, unchanged) — this route is the
// real supplier's own download, so it must keep showing BuildOhub as BUYER
// and the real supplier as SELLER, printing PurchaseOrder.poNumber as the
// document number. See apps/web's equivalent route, which renders the
// SAME underlying PurchaseOrder row in "BUYER" mode for the
// customer/builder portal instead — the two document numbers
// (po.poNumber vs po.orderNumber) are deliberately independent business
// numbers, never derived from one another.
const DOCUMENT_MODE: PoDocumentMode = "SUPPLIER";

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
