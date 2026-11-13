import { NextResponse } from "next/server";
import { PurchaseOrderStatus } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { issueOtpChallenge, deliverOtp, checkOtpSendRateLimit } from "@/lib/otp-service";
import { OtpPurpose } from "@matsrc/db";

export const dynamic = "force-dynamic";

// POST /api/builder/purchase-orders/[id]/send-otp — C37 fix.
//
// New endpoint: the previous implementation had NO send-OTP step at all —
// the approval UI collected a 6-digit code and posted it straight to
// /approve, which only checked its syntactic shape. This endpoint actually
// generates and dispatches a real, PO-scoped OTP challenge before approval
// can be attempted.
//
// Authorization: identical ownership check as the approve route below
// (PO must belong to the authenticated builder) — the OTP send step must
// never leak whether a PO exists to a user who doesn't own it, and must
// never let another builder trigger an OTP send for someone else's PO.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const ipLimit = checkOtpSendRateLimit(ip);
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: "Too many OTP requests. Please try again later." }, { status: 429 });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: { builder: true },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      return NextResponse.json({ error: "Only draft purchase orders can be approved" }, { status: 400 });
    }

    if (!po.builder.email) {
      return NextResponse.json(
        { error: "No registered email on file to send the approval OTP to." },
        { status: 400 }
      );
    }

    // Scoped to (purpose, identifier=email, purchaseOrderId) — an OTP issued
    // for one PO can never approve a different PO, and never satisfies
    // LOGIN_OTP verification (see lib/otp-service/challenge.ts).
    const issued = await issueOtpChallenge({
      purpose: OtpPurpose.PO_APPROVAL_OTP,
      identifier: po.builder.email,
      userId: user.id,
      purchaseOrderId: po.id,
    });

    if (!issued.ok) {
      return NextResponse.json({ error: issued.message }, { status: 429 });
    }

    // SMS (MSG91) is currently disabled (same as C20) — the OTP is always
    // sent via email, which is why a registered email is required above.
    const delivery = await deliverOtp(
      issued.challengeId,
      { phone: po.builder.phone ?? null, email: po.builder.email },
      issued.otp
    );

    if (!delivery.ok) {
      return NextResponse.json({ error: delivery.message }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      channel: delivery.channel,
      maskedTarget: delivery.maskedTarget,
      message:
        delivery.channel === "EMAIL"
          ? `OTP sent to your registered email (${delivery.maskedTarget}).`
          : `OTP sent via SMS to ${delivery.maskedTarget}.`,
    });
  } catch (error) {
    console.error("Purchase order send-otp error:", error);
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
