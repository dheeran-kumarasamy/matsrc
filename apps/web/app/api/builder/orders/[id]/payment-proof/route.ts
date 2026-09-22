import { NextResponse } from "next/server";
import { PaymentMethod, PaymentStatus } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { notifyPaymentProofSubmitted } from "@/lib/notify";
import { validatePaymentProofFile, buildSafePaymentProofFileName } from "@/lib/payment-proof-validation";

export const dynamic = "force-dynamic";

// GET /api/builder/orders/[id]/payment-proof
// Lets the customer see the current state of their own bank-transfer
// payment verification (submitted / pending / approved / rejected) so the
// payment page can render "Payment Verification Pending" etc. Scoped
// strictly to the requesting user's own order — never leaks another
// customer's payment proof or status.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const verification = await prisma.paymentVerification.findUnique({
      where: { orderId: order.id },
      select: {
        id: true,
        status: true,
        screenshotFileName: true,
        submittedAt: true,
        reviewedAt: true,
        rejectionReason: true,
        amount: true,
      },
    });

    if (!verification) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      status: verification.status,
      fileName: verification.screenshotFileName,
      submittedAt: verification.submittedAt,
      reviewedAt: verification.reviewedAt,
      rejectionReason: verification.rejectionReason,
      amount: Number(verification.amount),
    });
  } catch (error) {
    console.error("Payment proof GET error:", error);
    return NextResponse.json({ error: "Failed to fetch payment proof status" }, { status: 500 });
  }
}

// POST /api/builder/orders/[id]/payment-proof
// Accepts a multipart/form-data upload of the bank-transfer screenshot for
// the given order and creates/updates the PaymentVerification record,
// moving Order.paymentStatus to PENDING_VERIFICATION. Screenshot bytes are
// stored privately in the database (never a public URL) — see schema.prisma
// PaymentVerification doc comment. Deliberately idempotent: resubmitting
// while still PENDING simply overwrites the same row instead of creating a
// duplicate; the order/payment is never marked PAID and supplier processing
// is never triggered here — that only ever happens via admin approval.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    // Ownership check: the order must belong to the authenticated customer.
    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, paymentMethod: true, paymentStatus: true, totalAmount: true, status: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.paymentMethod !== PaymentMethod.BANK_TRANSFER) {
      return NextResponse.json(
        { error: "Payment proof upload is only available for the Standard (bank transfer) payment method" },
        { status: 400 }
      );
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      return NextResponse.json(
        { error: "This order has already been paid and verified" },
        { status: 400 }
      );
    }

    const existing = await prisma.paymentVerification.findUnique({
      where: { orderId: order.id },
      select: { id: true, status: true },
    });
    // Idempotency: block a second submission while one is already awaiting
    // admin review (prevents duplicate rows from double-clicks / retries).
    // A REJECTED proof may be resubmitted; an APPROVED one never can.
    if (existing?.status === "PENDING") {
      return NextResponse.json(
        { error: "A payment proof is already submitted and awaiting verification for this order" },
        { status: 409 }
      );
    }
    if (existing?.status === "APPROVED") {
      return NextResponse.json(
        { error: "This order's payment has already been verified" },
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
      return NextResponse.json({ error: "A payment screenshot file is required" }, { status: 400 });
    }

    // Server-side validation — never trust client-side checks alone.
    const validation = validatePaymentProofFile({ fileName: file.name, mimeType: file.type, size: file.size });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Never trust the uploaded filename for storage — only used for display.
    const safeFileName = buildSafePaymentProofFileName(order.id, file.name);

    if (existing) {
      await prisma.paymentVerification.update({
        where: { id: existing.id },
        data: {
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          amount: order.totalAmount,
          screenshotData: buffer,
          screenshotMimeType: file.type,
          screenshotFileName: safeFileName,
          screenshotSize: file.size,
          status: "PENDING",
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
        },
      });
    } else {
      await prisma.paymentVerification.create({
        data: {
          orderId: order.id,
          userId: user.id,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          amount: order.totalAmount,
          screenshotData: buffer,
          screenshotMimeType: file.type,
          screenshotFileName: safeFileName,
          screenshotSize: file.size,
          status: "PENDING",
        },
      });
    }

    // Payment enters PENDING_VERIFICATION — order is deliberately NOT
    // confirmed/paid and supplier processing is NOT triggered here. That
    // only ever happens once an admin approves the proof.
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PENDING_VERIFICATION },
    });

    await prisma.orderTracking.create({
      data: {
        orderId: order.id,
        status: order.status,
        note: "Payment screenshot submitted — awaiting admin verification",
      },
    });

    // Best-effort customer notification (mirrors the existing WhatsApp
    // notification pattern used elsewhere in this app — see lib/notify.ts).
    void notifyPaymentProofSubmitted(order.id).catch((error) => {
      console.error("notifyPaymentProofSubmitted error:", error);
    });

    return NextResponse.json({ status: "PENDING", submitted: true }, { status: 201 });
  } catch (error) {
    console.error("Payment proof POST error:", error);
    return NextResponse.json({ error: "Failed to submit payment proof" }, { status: 500 });
  }
}
