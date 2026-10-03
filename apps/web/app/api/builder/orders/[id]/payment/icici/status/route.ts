import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { isIciciUatAvailable } from "@/lib/icici/environment";

export const dynamic = "force-dynamic";

// GET /api/builder/orders/[id]/payment/icici/status
//
// ICICI Bank Payment Gateway — UAT ONLY. Lets the authenticated builder poll
// the current, server-verified state of their most recent ICICI payment
// attempt for this order — used by the payment result page (task §25). The
// browser NEVER calls ICICI directly; this only ever reads Buildohub's own
// PaymentTransaction row, which is only ever updated by the server-side
// callback/STATUS-verification flow (see app/api/payment/callback).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isIciciUatAvailable()) {
      return NextResponse.json({ error: "ICICI online payment is not available in this environment" }, { status: 404 });
    }

    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, paymentStatus: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const transaction = await prisma.paymentTransaction.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      select: {
        paymentReference: true,
        merchantTxnNo: true,
        status: true,
        amount: true,
        gatewayResponseDescription: true,
        initiatedAt: true,
        completedAt: true,
        failedAt: true,
      },
    });

    if (!transaction) {
      return NextResponse.json({ exists: false, orderPaymentStatus: order.paymentStatus });
    }

    return NextResponse.json({
      exists: true,
      orderPaymentStatus: order.paymentStatus,
      paymentReference: transaction.paymentReference,
      status: transaction.status,
      amount: Number(transaction.amount),
      message: transaction.gatewayResponseDescription,
      initiatedAt: transaction.initiatedAt,
      completedAt: transaction.completedAt,
      failedAt: transaction.failedAt,
    });
  } catch (error) {
    console.error("ICICI status GET error:", error);
    return NextResponse.json({ error: "Failed to fetch ICICI payment status" }, { status: 500 });
  }
}
