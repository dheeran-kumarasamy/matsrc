import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";
import { validateSupplierInvoiceFile, buildSafeSupplierInvoiceFileName } from "@/lib/supplier-invoice-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/supplier/orders/[id]/invoice
// Metadata-only status read (never raw bytes — see the sibling
// /download route) for the authenticated supplier's OWN uploaded invoice.
// Mirrors apps/web's rating-receipt GET route convention exactly.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { supplierProfile } = await ensureSupplierContext(email);

    // Ownership check: the order must have at least one line item belonging
    // to THIS supplier — a supplier can never upload against or view an
    // invoice for an order/line item belonging to a different supplier,
    // even if the orderId is otherwise valid (mirrors
    // getSupplierOrderDetail's existing ownership scoping).
    const order = await prisma.order.findFirst({
      where: { id: params.id, items: { some: { supplierId: supplierProfile.id } } },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { orderId: order.id },
      select: {
        status: true,
        fileName: true,
        fileSize: true,
        uploadedAt: true,
        supplierInvoiceNumber: true,
        supplierInvoiceDate: true,
        rejectionReason: true,
        confirmedAt: true,
      },
    });

    if (!invoice) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      status: invoice.status,
      fileName: invoice.fileName,
      size: invoice.fileSize,
      uploadedAt: invoice.uploadedAt,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      supplierInvoiceDate: invoice.supplierInvoiceDate,
      rejectionReason: invoice.rejectionReason,
      confirmedAt: invoice.confirmedAt,
    });
  } catch (error) {
    console.error("Supplier invoice GET error:", error);
    return NextResponse.json({ error: "Failed to fetch invoice status" }, { status: 500 });
  }
}

// POST /api/supplier/orders/[id]/invoice
// Uploads (or REPLACES, if the previous upload was REJECTED) the
// supplier's own original invoice document for this order. The upload
// alone NEVER generates a BuildOhub buyer invoice — it only creates/
// resets a SupplierInvoice row in PENDING_REVIEW, awaiting Admin review.
// The original file bytes are preserved exactly as uploaded — never
// regenerated/re-rendered.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { user, supplierProfile } = await ensureSupplierContext(email);

    const order = await prisma.order.findFirst({
      where: { id: params.id, items: { some: { supplierId: supplierProfile.id } } },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const existing = await prisma.supplierInvoice.findUnique({
      where: { orderId: order.id },
      select: { id: true, status: true },
    });

    // A CONFIRMED invoice (the admin has already verified it and a
    // BuildOhub buyer invoice may already exist from it) can never be
    // silently replaced by a fresh supplier upload — correction after
    // confirmation is a separate, explicit process this phase does not
    // implement (see Final Report's documented limitation).
    if (existing?.status === "CONFIRMED") {
      return NextResponse.json(
        { error: "This invoice has already been confirmed and cannot be replaced" },
        { status: 400 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "An invoice file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateSupplierInvoiceFile({ fileName: file.name, mimeType: file.type, size: file.size, buffer });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const safeFileName = buildSafeSupplierInvoiceFileName(order.id, file.name);

    const supplierInvoiceNumberRaw = formData.get("supplierInvoiceNumber");
    const supplierInvoiceDateRaw = formData.get("supplierInvoiceDate");
    const supplierInvoiceNumber =
      typeof supplierInvoiceNumberRaw === "string" && supplierInvoiceNumberRaw.trim()
        ? supplierInvoiceNumberRaw.trim()
        : null;
    const supplierInvoiceDate =
      typeof supplierInvoiceDateRaw === "string" && supplierInvoiceDateRaw ? new Date(supplierInvoiceDateRaw) : null;

    // Find the PO associated with this order, if any — purely an optional
    // admin/backend cross-reference (see SupplierInvoice.purchaseOrderId).
    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: { orderId: order.id, supplierId: supplierProfile.id },
      select: { id: true },
      orderBy: { version: "desc" },
    });

    // Idempotent replace-in-place: an upload following a REJECTED review
    // resets status back to PENDING_REVIEW and clears the previous
    // rejection — never creates a second row (orderId is @unique).
    //
    // Audit fix: when REPLACING a REJECTED invoice's file, the review
    // state attached to the DISCARDED document (SupplierInvoiceLineItem
    // rows + confirmed totals/discrepancy flags) must never silently carry
    // forward onto the new file — otherwise confirm() could later accept
    // the new upload using figures an admin only ever reviewed against the
    // OLD, now-replaced document. Deleting the stale line items and
    // resetting every review/total field happens in the SAME transaction
    // as the file-row upsert, so a reader can never observe a half-reset
    // state (new file + stale review data, or vice versa).
    const saved = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.supplierInvoiceLineItem.deleteMany({ where: { supplierInvoiceId: existing.id } });
      }

      return tx.supplierInvoice.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          supplierId: supplierProfile.id,
          purchaseOrderId: purchaseOrder?.id ?? null,
          status: "PENDING_REVIEW",
          fileData: buffer,
          fileMimeType: file.type,
          fileName: safeFileName,
          fileSize: file.size,
          supplierInvoiceNumber,
          supplierInvoiceDate,
          uploadedBy: user.id,
          uploadedAt: new Date(),
        },
        update: {
          status: "PENDING_REVIEW",
          fileData: buffer,
          fileMimeType: file.type,
          fileName: safeFileName,
          fileSize: file.size,
          supplierInvoiceNumber,
          supplierInvoiceDate,
          uploadedBy: user.id,
          uploadedAt: new Date(),
          rejectedAt: null,
          rejectedBy: null,
          rejectionReason: null,
          // Reset every review/reconciliation field left over from the
          // DISCARDED document's review — never carried forward onto the
          // replacement file. The new upload is reviewed from scratch.
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTaxableValue: null,
          confirmedTaxAmount: null,
          confirmedTotalAmount: null,
          hasDiscrepancy: false,
          discrepancyNotes: null,
        },
        select: { orderId: true, status: true, fileName: true, uploadedAt: true, fileSize: true },
      });
    });

    return NextResponse.json(
      {
        orderId: saved.orderId,
        status: saved.status,
        fileName: saved.fileName,
        uploadedAt: saved.uploadedAt,
        size: saved.fileSize,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Supplier invoice POST error:", error);
    return NextResponse.json({ error: "Failed to upload invoice" }, { status: 500 });
  }
}
