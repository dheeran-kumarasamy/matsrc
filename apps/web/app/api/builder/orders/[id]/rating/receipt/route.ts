import { NextResponse } from "next/server";
import { OrderStatus } from "@matsrc/db";
import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";
import { validateRatingReceiptFile, buildSafeRatingReceiptFileName } from "@/lib/rating-receipt-validation";

export const dynamic = "force-dynamic";

// 72-hour rating edit window (same constant as the sibling
// app/api/builder/orders/[id]/rating/route.ts — a receipt may only be
// attached/replaced while the rating itself is still editable).
const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;

// GET /api/builder/orders/[id]/rating/receipt
// Lets the rating submitter see whether a receipt is attached to their own
// rating (filename + upload timestamp only — never the raw bytes here).
// Scoped strictly to the requesting user's own order, exactly like the
// payment-proof GET route — never leaks another builder's receipt metadata.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, { status: 404 });
    }

    const rating = await prisma.supplierRating.findUnique({
      where: { orderId: order.id },
      select: { receiptFileName: true, receiptUploadedAt: true, receiptSize: true, createdAt: true },
    });

    if (!rating) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Rating not found for this order" } }, { status: 404 });
    }

    const canEditUntil = rating.createdAt.getTime() + EDIT_WINDOW_MS;

    return NextResponse.json({
      exists: Boolean(rating.receiptFileName),
      fileName: rating.receiptFileName ?? null,
      uploadedAt: rating.receiptUploadedAt ?? null,
      size: rating.receiptSize ?? null,
      editableUntil: new Date(canEditUntil).toISOString(),
      editable: Date.now() <= canEditUntil,
    });
  } catch (error) {
    console.error("Rating receipt GET error:", error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch receipt status" } }, { status: 500 });
  }
}

// POST /api/builder/orders/[id]/rating/receipt
// Accepts a multipart/form-data upload of a receipt copy for an EXISTING
// rating on the given order, and attaches it to the SupplierRating row.
// Deliberately a SEPARATE endpoint from the JSON rating-mutation route
// (app/api/builder/orders/[id]/rating/route.ts) — mirrors the existing
// payment-proof upload pattern exactly, so a receipt-upload failure can
// never roll back or invalidate an already-saved rating, and vice versa.
// Receipt bytes are stored privately in the database (never a public URL)
// — see schema.prisma SupplierRating doc comment. Idempotent: resubmitting
// while still within the 72-hour rating edit window simply overwrites the
// existing receipt instead of creating a duplicate row (SupplierRating.
// orderId is already @unique, so there is only ever one row to update).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    // Ownership check: the order must belong to the authenticated caller —
    // prevents attaching a receipt to another builder's order by supplying
    // a different orderId, even if that orderId is otherwise valid.
    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, status: true },
    });
    if (!order) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, { status: 404 });
    }

    if (order.status !== OrderStatus.DELIVERED) {
      return NextResponse.json(
        { error: { code: "ORDER_NOT_DELIVERED", message: "Receipts can only be attached to delivered orders" } },
        { status: 400 },
      );
    }

    // A receipt may only be attached to a rating that already exists —
    // prevents an orphaned receipt with no associated rating, and keeps the
    // rating-save / receipt-upload steps independently idempotent.
    const rating = await prisma.supplierRating.findUnique({
      where: { orderId: order.id },
      select: { id: true, createdAt: true },
    });
    if (!rating) {
      return NextResponse.json(
        { error: { code: "RATING_NOT_FOUND", message: "Submit a rating for this order before attaching a receipt" } },
        { status: 404 },
      );
    }

    // Reuse the exact same 72-hour rating edit window that governs editing
    // the rating itself — a receipt cannot be attached/replaced once that
    // window has closed, preserving the existing rating-edit semantics.
    const canEditUntil = rating.createdAt.getTime() + EDIT_WINDOW_MS;
    if (Date.now() > canEditUntil) {
      return NextResponse.json(
        { error: { code: "EDIT_WINDOW_EXPIRED", message: "Rating edit window has expired" } },
        { status: 400 },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Expected multipart/form-data with a 'file' field" } },
        { status: 400 },
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "A receipt file is required" } },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Server-side validation — never trust client-side checks alone.
    // Includes a file-signature ("magic bytes") check against the actual
    // uploaded content, not just the client-declared MIME type/extension.
    const validation = validateRatingReceiptFile({ fileName: file.name, mimeType: file.type, size: file.size, buffer });
    if (!validation.valid) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: validation.error } }, { status: 400 });
    }

    // Never trust the uploaded filename for storage — only used for display.
    const safeFileName = buildSafeRatingReceiptFileName(order.id, file.name);

    const updated = await prisma.supplierRating.update({
      where: { orderId: order.id },
      data: {
        receiptData: buffer,
        receiptMimeType: file.type,
        receiptFileName: safeFileName,
        receiptSize: file.size,
        receiptUploadedAt: new Date(),
      },
      select: { orderId: true, receiptFileName: true, receiptUploadedAt: true, receiptSize: true },
    });

    return NextResponse.json(
      {
        orderId: updated.orderId,
        fileName: updated.receiptFileName,
        uploadedAt: updated.receiptUploadedAt,
        size: updated.receiptSize,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Rating receipt POST error:", error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to upload receipt" } }, { status: 500 });
  }
}
