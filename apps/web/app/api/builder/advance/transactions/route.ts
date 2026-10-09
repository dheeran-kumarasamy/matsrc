import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// GET /api/builder/advance/transactions
//
// The buyer's own Buildohub Advance Balance History — every ledger entry
// (CREDIT/ORDER_PAYMENT/REFUND/REVERSAL/ADJUSTMENT) for their own account,
// most-recent first. Scoped strictly via the account's buyerId — a buyer
// can never see another buyer's ledger.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const account = await prisma.customerAdvanceAccount.findUnique({
      where: { buyerId: user.id },
      select: { id: true },
    });

    if (!account) {
      return NextResponse.json({ transactions: [] });
    }

    const transactions = await prisma.customerAdvanceTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        reference: true,
        createdAt: true,
        order: { select: { id: true, enquiryId: true, orderNumber: true } },
        advancePayment: { select: { id: true, referenceNumber: true } },
      },
    });

    return NextResponse.json({
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceAfter: Number(t.balanceAfter),
        reference: t.reference,
        orderId: t.order?.id ?? null,
        orderReference: t.order?.enquiryId ?? t.order?.orderNumber ?? null,
        advancePaymentReference: t.advancePayment?.referenceNumber ?? null,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error("Advance transactions GET error:", error);
    return NextResponse.json({ error: "Failed to fetch advance transaction history" }, { status: 500 });
  }
}
