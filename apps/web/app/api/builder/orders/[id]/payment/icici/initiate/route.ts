import { NextResponse } from "next/server";
import { PaymentStatus, PaymentTransactionStatus } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { isIciciUatAvailable } from "@/lib/icici/environment";
import { getIciciConfig } from "@/lib/icici/config";
import { generateMerchantTxnNo } from "@/lib/icici/merchant-txn";
import { generatePaymentReference } from "@/lib/icici/payment-reference";
import { initiateSale } from "@/lib/icici/client";

export const dynamic = "force-dynamic";

// POST /api/builder/orders/[id]/payment/icici/initiate
//
// ICICI Bank Payment Gateway — UAT ONLY. Authenticated initiation endpoint.
// The ICICI payment method is NEVER initiated outside Buildohub's UAT
// environment — isIciciUatAvailable()/getIciciConfig() are the single source
// of truth for that guard (see lib/icici/environment.ts). A caller hitting
// this route on production (where the env guard always resolves false)
// receives a 404, identical to "feature not available here" — it never
// leaks whether the feature exists at all.
//
// Amount security (task §17): the amount sent to ICICI is ALWAYS
// Order.totalAmount read fresh from the database in this request — nothing
// from the request body is ever used to determine the payable amount.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isIciciUatAvailable()) {
      return NextResponse.json({ error: "ICICI online payment is not available in this environment" }, { status: 404 });
    }

    const config = getIciciConfig();
    if (!config) {
      return NextResponse.json({ error: "ICICI online payment is not configured" }, { status: 503 });
    }

    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    // Ownership + eligibility check — mirrors the existing payment-proof
    // route's pattern (scoped to the authenticated builder's own order).
    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        enquiryId: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      return NextResponse.json({ error: "This order has already been paid" }, { status: 400 });
    }
    if (order.paymentStatus === PaymentStatus.PENDING_VERIFICATION) {
      return NextResponse.json(
        { error: "A bank-transfer payment proof is already awaiting verification for this order" },
        { status: 409 }
      );
    }

    // Idempotency (task §23): if a prior attempt for this order is already
    // INITIATED/REDIRECTED/PENDING, reuse it instead of creating a duplicate
    // gateway transaction — protects against double-clicking "Pay Now" or a
    // page refresh triggering a second initiation while the first is still
    // in flight.
    const inFlight = await prisma.paymentTransaction.findFirst({
      where: {
        orderId: order.id,
        status: { in: [PaymentTransactionStatus.INITIATED, PaymentTransactionStatus.REDIRECTED, PaymentTransactionStatus.PENDING] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (inFlight) {
      return NextResponse.json({
        paymentReference: inFlight.paymentReference,
        merchantTxnNo: inFlight.merchantTxnNo,
        status: inFlight.status,
        reused: true,
      });
    }

    // Server-side payable amount — never trusts any browser-supplied value.
    const payableAmount = Number(order.totalAmount).toFixed(2);

    const merchantTxnNo = generateMerchantTxnNo();
    const paymentReference = generatePaymentReference();

    const transaction = await prisma.paymentTransaction.create({
      data: {
        orderId: order.id,
        userId: user.id,
        paymentReference,
        gateway: "ICICI",
        gatewayEnvironment: config.environment,
        merchantTxnNo,
        amount: order.totalAmount,
        currency: "INR",
        status: PaymentTransactionStatus.INITIATED,
      },
    });

    const result = await initiateSale(config, {
      merchantTxnNo,
      amount: payableAmount,
      customerEmailId: ctx.email,
      // ICICI UAT sandbox accepts a placeholder test mobile number; this is
      // replaced by the real verified builder contact number once that is
      // reliably collected at checkout — never a hard dependency for UAT.
      customerMobileNo: "9999999999",
    });

    if (!result.ok) {
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: PaymentTransactionStatus.PENDING,
          initiationRequest: result.rawRequest as any,
          gatewayResponseDescription: result.error,
        },
      });
      // Gateway unreachable/timeout — never mark FAILED on a transient
      // network issue (task §29); PENDING signals "retry/verify later".
      return NextResponse.json(
        { error: "Unable to reach ICICI UAT gateway. Please try again shortly.", paymentReference, status: "PENDING" },
        { status: 502 }
      );
    }

    const redirectUrl = result.data?.redirectUrl || result.data?.redirectURL || null;

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: redirectUrl ? PaymentTransactionStatus.REDIRECTED : PaymentTransactionStatus.PENDING,
        initiationRequest: result.rawRequest as any,
        initiationResponse: result.data as any,
        gatewayResponseCode: result.data?.responseCode ?? null,
        gatewayResponseDescription: result.data?.responseDescription ?? null,
        gatewayTxnId: result.data?.bankTxnId ?? result.data?.gatewayTxnId ?? null,
      },
    });

    return NextResponse.json({
      paymentReference,
      merchantTxnNo,
      amount: Number(payableAmount),
      redirectUrl,
      status: redirectUrl ? "REDIRECTED" : "PENDING",
    });
  } catch (error) {
    console.error("ICICI initiate POST error:", error);
    return NextResponse.json({ error: "Failed to initiate ICICI payment" }, { status: 500 });
  }
}
