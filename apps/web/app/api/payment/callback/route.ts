import { NextResponse } from "next/server";
import { PaymentMethod, PaymentStatus, PaymentTransactionStatus, OrderStatus } from "@matsrc/db";
import { prisma } from "@/lib/builder-db";
import { getSiteUrl } from "@/lib/site-url";
import { isIciciUatAvailable } from "@/lib/icici/environment";
import { getIciciConfig } from "@/lib/icici/config";
import { verifyICICIHash } from "@/lib/icici/hash";
import { queryStatus } from "@/lib/icici/client";

export const dynamic = "force-dynamic";

// POST /api/payment/callback
//
// ICICI Bank Payment Gateway — UAT ONLY. Public callback endpoint (ICICI
// cannot authenticate as a Buildohub user, so this route is intentionally
// unauthenticated) — every trust decision here instead comes from
// cryptographic HMAC verification (verifyICICIHash) plus an independent
// server-side STATUS re-query (task §21/§22), NEVER from the callback
// payload alone.
//
// UAT callback URL: https://uat.buildohub.in/api/payment/callback — this
// MUST be registered/whitelisted on ICICI's side for the UAT merchant
// configuration (see docs/payments/icici-uat.md). If ICICI only has
// https://buildohub.in/api/payment/callback configured for this merchant,
// the UAT gateway will simply never reach this UAT deployment — that is an
// ICICI-side configuration dependency, not something this code can or
// should silently work around.
//
// Idempotency (task §23): a duplicate callback for an already-SUCCESS
// transaction is a harmless no-op — it is re-verified but never re-processed
// into a second "success" side effect.
export async function POST(request: Request) {
  try {
    if (!isIciciUatAvailable()) {
      // Never process an ICICI callback outside the UAT environment —
      // including, critically, on the production deployment, even if ICICI
      // were (incorrectly) pointed at it.
      return NextResponse.json({ error: "ICICI payment callback is not available in this environment" }, { status: 404 });
    }

    const config = getIciciConfig();
    if (!config) {
      return NextResponse.json({ error: "ICICI online payment is not configured" }, { status: 503 });
    }

    const contentType = request.headers.get("content-type") || "";
    let payload: Record<string, any>;
    if (contentType.includes("application/json")) {
      payload = await request.json().catch(() => ({}));
    } else {
      // ICICI's callback is commonly application/x-www-form-urlencoded.
      const form = await request.formData().catch(() => null);
      payload = {};
      if (form) {
        form.forEach((value, key) => {
          payload[key] = String(value);
        });
      }
    }

    const merchantTxnNo = payload.merchantTxnNo;
    if (!merchantTxnNo || typeof merchantTxnNo !== "string") {
      return NextResponse.json({ error: "Missing merchantTxnNo in callback payload" }, { status: 400 });
    }

    const transaction = await prisma.paymentTransaction.findUnique({
      where: { merchantTxnNo },
      include: { order: true },
    });
    if (!transaction) {
      // Unknown transaction — log server-side (safe fields only) and reject;
      // never guess/associate it with any order.
      console.error("ICICI callback: unknown merchantTxnNo", { merchantTxnNo });
      return NextResponse.json({ error: "Unknown transaction" }, { status: 404 });
    }

    // Already SUCCESS — duplicate callback is a harmless, idempotent no-op.
    if (transaction.status === PaymentTransactionStatus.SUCCESS) {
      return redirectToResult(transaction.orderId, "SUCCESS");
    }

    const hashOk = verifyICICIHash(payload as any, config.secretKey);

    // Amount validation — the callback-claimed amount must match what
    // Buildohub itself recorded at initiation time (task §20.6).
    const callbackAmount = payload.amount !== undefined ? Number(payload.amount) : null;
    const amountMatches = callbackAmount !== null && Math.abs(callbackAmount - Number(transaction.amount)) < 0.01;

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        returnPayload: payload,
        secureHashVerified: hashOk,
      },
    });

    if (!hashOk || !amountMatches) {
      console.error("ICICI callback: hash/amount verification failed", {
        merchantTxnNo,
        hashOk,
        amountMatches,
      });
      // Do not trust this callback — fall through to a server-side STATUS
      // verification below anyway, since the callback itself proves nothing
      // either way (task §22: "Do not trust the callback alone as proof").
    }

    // Server-side STATUS verification — the ONLY basis (together with a
    // verified hash) for ever marking SUCCESS. The browser never calls this.
    const statusResult = await queryStatus(config, merchantTxnNo);

    if (!statusResult.ok) {
      // Gateway unreachable for verification — remain PENDING, never FAILED,
      // so a retry/admin refresh can re-verify later (task §29).
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: { status: PaymentTransactionStatus.PENDING, statusRequest: statusResult.rawRequest as any },
      });
      return redirectToResult(transaction.orderId, "VERIFICATION_IN_PROGRESS");
    }

    const statusData = statusResult.data || {};
    const statusHashOk = verifyICICIHash(statusData, config.secretKey);
    const gatewayStatus = String(statusData.transactionStatus || statusData.status || "").toUpperCase();

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        statusRequest: statusResult.rawRequest as any,
        statusResponse: statusData as any,
        secureHashVerified: hashOk && statusHashOk,
        gatewayResponseCode: statusData.responseCode ?? transaction.gatewayResponseCode,
        gatewayResponseDescription: statusData.responseDescription ?? transaction.gatewayResponseDescription,
        gatewayTxnId: statusData.bankTxnId ?? statusData.gatewayTxnId ?? transaction.gatewayTxnId,
        gatewayTxnAuthId: statusData.authId ?? statusData.gatewayTxnAuthId ?? transaction.gatewayTxnAuthId,
        paymentMode: statusData.paymentMode ?? transaction.paymentMode,
        paymentSubInstrumentType: statusData.paymentSubInstrumentType ?? transaction.paymentSubInstrumentType,
      },
    });

    if (!statusHashOk) {
      console.error("ICICI STATUS verification: hash mismatch — refusing to trust response", { merchantTxnNo });
      return redirectToResult(transaction.orderId, "VERIFICATION_IN_PROGRESS");
    }

    if (gatewayStatus === "SUCCESS" || gatewayStatus === "SUCCESSFUL") {
      await markSuccess(transaction.id, transaction.orderId);
      return redirectToResult(transaction.orderId, "SUCCESS");
    }

    if (gatewayStatus === "PENDING") {
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: { status: PaymentTransactionStatus.PENDING },
      });
      return redirectToResult(transaction.orderId, "PENDING");
    }

    if (gatewayStatus === "CANCELLED" || gatewayStatus === "CANCEL") {
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: { status: PaymentTransactionStatus.CANCELLED, failedAt: new Date() },
      });
      return redirectToResult(transaction.orderId, "CANCELLED");
    }

    // Any other explicit terminal gateway status is treated as FAILED.
    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: { status: PaymentTransactionStatus.FAILED, failedAt: new Date() },
    });
    return redirectToResult(transaction.orderId, "FAILED");
  } catch (error) {
    console.error("ICICI callback POST error:", error);
    return NextResponse.json({ error: "Failed to process ICICI callback" }, { status: 500 });
  }
}

async function markSuccess(transactionId: string, orderId: string) {
  // Idempotent: PaymentStatus.PAID / PaymentTransactionStatus.SUCCESS is a
  // terminal state — re-running this on an already-PAID order changes
  // nothing further, so a duplicate verified callback never double-processes.
  await prisma.$transaction(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({ where: { id: transactionId } });
    if (!current || current.status === PaymentTransactionStatus.SUCCESS) return;

    await tx.paymentTransaction.update({
      where: { id: transactionId },
      data: { status: PaymentTransactionStatus.SUCCESS, completedAt: new Date() },
    });

    const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, paymentStatus: true } });
    if (!order || order.paymentStatus === PaymentStatus.PAID) return;

    const nextStatus = order.status === OrderStatus.PLACED ? OrderStatus.PROCESSING : order.status;

    await tx.order.update({
      where: { id: orderId },
      data: {
        paymentMethod: PaymentMethod.ICICI_ONLINE,
        paymentStatus: PaymentStatus.PAID,
        status: nextStatus,
      },
    });

    await tx.orderTracking.create({
      data: {
        orderId,
        status: nextStatus,
        note: "Payment verified via ICICI UAT gateway (server-side STATUS confirmed) — order confirmed for supplier processing",
      },
    });
  });
}

function redirectToResult(orderId: string, outcome: string) {
  const url = new URL(`/orders/${orderId}/payment/result`, getSiteUrl());
  url.searchParams.set("outcome", outcome);
  return NextResponse.redirect(url, { status: 303 });
}
