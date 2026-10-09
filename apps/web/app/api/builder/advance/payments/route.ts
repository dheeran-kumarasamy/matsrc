import { NextResponse } from "next/server";
import { generateAdvancePaymentNumber, getOrCreateAdvanceAccount } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { validatePaymentProofFile, buildSafePaymentProofFileName } from "@/lib/payment-proof-validation";
import { notifyAdvancePaymentSubmitted } from "@/lib/notify-advance";

export const dynamic = "force-dynamic";

const MIN_ADVANCE_AMOUNT = 1;
// No hard business maximum has been configured anywhere else in the repo
// for a single payment; guard only against clearly invalid/overflow input.
const MAX_ADVANCE_AMOUNT = 10_000_000;

// GET /api/builder/advance/payments
// The buyer's own advance-payment submissions (PENDING/APPROVED/REJECTED),
// most-recent first — feeds the "Pending Advance" / history sections of the
// Buildohub Advance Balance page.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const payments = await prisma.advancePayment.findMany({
      where: { buyerId: user.id },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        referenceNumber: true,
        amount: true,
        paymentMethod: true,
        status: true,
        paymentReference: true,
        submittedAt: true,
        approvedAt: true,
        rejectedAt: true,
        rejectionReason: true,
      },
    });

    return NextResponse.json({
      payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    });
  } catch (error) {
    console.error("Advance payments GET error:", error);
    return NextResponse.json({ error: "Failed to fetch advance payments" }, { status: 500 });
  }
}

// POST /api/builder/advance/payments
//
// Buyer submits a manual Buildohub Advance Payment (amount + UTR/payment
// reference + screenshot), reusing the EXACT SAME payment-proof validation/
// storage shape as the existing order bank-transfer flow (see
// apps/web/lib/payment-proof-validation.ts and
// apps/web/app/api/builder/orders/[id]/payment-proof/route.ts). Never
// increases the available balance itself — status starts PENDING and only
// an Admin APPROVED transition credits the ledger (see
// apps/api/src/admin/advance-payments/advance-payments.service.ts).
export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const amountRaw = formData.get("amount");
    const paymentReference = formData.get("paymentReference");
    const file = formData.get("file");

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < MIN_ADVANCE_AMOUNT || amount > MAX_ADVANCE_AMOUNT) {
      return NextResponse.json({ error: "Enter a valid advance amount" }, { status: 400 });
    }
    // Reject more than 2 decimal places (paise precision) — never trust
    // frontend rounding.
    if (Math.round(amount * 100) !== amount * 100) {
      return NextResponse.json({ error: "Amount cannot have more than 2 decimal places" }, { status: 400 });
    }

    if (typeof paymentReference !== "string" || !paymentReference.trim()) {
      return NextResponse.json({ error: "Payment reference / UTR is required" }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A payment screenshot file is required" }, { status: 400 });
    }

    const validation = validatePaymentProofFile({ fileName: file.name, mimeType: file.type, size: file.size });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeFileName = buildSafePaymentProofFileName(`advance-${user.id}-${Date.now()}`, file.name);

    const account = await getOrCreateAdvanceAccount(prisma as any, user.id);

    const created = await prisma.$transaction(async (tx) => {
      const referenceNumber = await generateAdvancePaymentNumber(tx as any);

      return tx.advancePayment.create({
        data: {
          advanceAccountId: account.id,
          buyerId: user.id,
          referenceNumber,
          amount,
          paymentMethod: "MANUAL",
          status: "PENDING",
          paymentReference: paymentReference.trim(),
          screenshotData: buffer,
          screenshotMimeType: file.type,
          screenshotFileName: safeFileName,
          screenshotSize: file.size,
        },
        select: { id: true, referenceNumber: true, amount: true, status: true, submittedAt: true },
      });
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "ADVANCE_PAYMENT_SUBMITTED",
        entityType: "AdvancePayment",
        entityId: created.id,
        metadata: { amount, referenceNumber: created.referenceNumber },
      },
    });

    void notifyAdvancePaymentSubmitted(created.id).catch((error) => {
      console.error("notifyAdvancePaymentSubmitted error:", error);
    });

    return NextResponse.json(
      {
        id: created.id,
        referenceNumber: created.referenceNumber,
        amount: Number(created.amount),
        status: created.status,
        submittedAt: created.submittedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Advance payment POST error:", error);
    return NextResponse.json({ error: "Failed to submit advance payment" }, { status: 500 });
  }
}
