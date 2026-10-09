import { NextResponse } from "next/server";
import { PaymentStatus } from "@matsrc/db";
import { appendLedgerEntry, lockAdvanceAccountRow } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { computeOrderOutstandingAmount } from "@/lib/order-outstanding";

export const dynamic = "force-dynamic";

class ValidationError extends Error {}

// GET /api/builder/orders/[id]/advance-payment
// Returns the order's current outstanding amount plus the buyer's available
// advance balance — feeds the "Use Advance Balance?" panel on the order
// payment page. Advance usage is ALWAYS optional and defaults to not being
// shown as applied; this endpoint never applies anything by itself.
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

    const { totalAmount, advanceApplied, outstanding } = await computeOrderOutstandingAmount(order.id);

    const account = await prisma.customerAdvanceAccount.findUnique({
      where: { buyerId: user.id },
      select: { availableBalance: true, status: true },
    });

    return NextResponse.json({
      totalAmount,
      advanceApplied,
      outstanding,
      availableBalance: account ? Number(account.availableBalance) : 0,
      accountStatus: account?.status ?? "ACTIVE",
    });
  } catch (error) {
    console.error("Order advance-payment GET error:", error);
    return NextResponse.json({ error: "Failed to fetch advance-payment summary" }, { status: 500 });
  }
}

// POST /api/builder/orders/[id]/advance-payment
//
// Buyer EXPLICITLY opts in to applying some/all of their Buildohub Advance
// Balance toward this order's outstanding amount. The default order-payment
// screen never calls this route automatically — it is only ever invoked
// after the buyer selects "Use Advance Balance = Yes" and enters an amount.
//
// Server-side authoritative validation (never trusts the frontend):
//   amount > 0
//   amount <= current available balance (re-read inside a locked transaction)
//   amount <= order's current outstanding amount (re-computed server-side)
//
// Concurrency: the CustomerAdvanceAccount row is locked
// (`SELECT ... FOR UPDATE`) inside the same `$transaction` that both
// re-validates the balance and writes the ORDER_PAYMENT ledger entry, so two
// concurrent orders can never overspend the same advance balance.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const body = await request.json().catch(() => ({}));
    const amount = Number(body?.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Advance amount must be a positive number" }, { status: 400 });
    }
    if (Math.round(amount * 100) !== amount * 100) {
      return NextResponse.json({ error: "Amount cannot have more than 2 decimal places" }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, paymentStatus: true, status: true, enquiryId: true, orderNumber: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.status === "CANCELLED") {
      return NextResponse.json({ error: "This order has been cancelled" }, { status: 400 });
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      return NextResponse.json({ error: "This order has already been paid" }, { status: 400 });
    }

    const account = await prisma.customerAdvanceAccount.findUnique({
      where: { buyerId: user.id },
      select: { id: true, status: true },
    });
    if (!account || account.status !== "ACTIVE") {
      return NextResponse.json({ error: "No active Buildohub Advance Balance account" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock the advance account row FIRST so a concurrent debit against the
      // same account (e.g. a second order's payment, or a second tab) can
      // never read a stale balance — see spec §28 Concurrent Payment
      // Protection.
      const locked = await lockAdvanceAccountRow(tx as any, account.id);
      const currentBalance = Number(locked.availableBalance);

      // Re-read the order's outstanding amount from WITHIN the same locked
      // transaction — never trust a value computed before the lock, or any
      // value supplied by the client.
      const { outstanding } = await computeOrderOutstandingAmountTx(tx, order.id);

      if (amount > currentBalance) {
        throw new ValidationError("Advance amount exceeds your available balance");
      }
      if (amount > outstanding) {
        throw new ValidationError("Advance amount exceeds the order's outstanding amount");
      }

      const { balanceAfter } = await appendLedgerEntry(tx as any, {
        accountId: account.id,
        type: "ORDER_PAYMENT",
        amount,
        currentBalance,
        reference: order.enquiryId ?? order.orderNumber ?? order.id,
        orderId: order.id,
        createdBy: user.id,
      });

      const newOutstanding = Math.max(0, Math.round((outstanding - amount) * 100) / 100);

      // Fully covering the order's outstanding amount marks it PAID,
      // following the exact same order/payment state machine the existing
      // bank-transfer approval flow uses (PaymentStatus.PAID) — no separate/
      // parallel payment-state introduced for advance-funded orders.
      if (newOutstanding === 0) {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: PaymentStatus.PAID } });
        await tx.orderTracking.create({
          data: { orderId: order.id, status: "PROCESSING" as any, note: "Order fully paid using Buildohub Advance Balance" },
        });
      }

      return { balanceAfter, newOutstanding };
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "ADVANCE_BALANCE_DEBITED",
        entityType: "Order",
        entityId: order.id,
        metadata: { amount, newBalance: result.balanceAfter, newOutstanding: result.newOutstanding },
      },
    });

    return NextResponse.json({
      advanceApplied: amount,
      remainingOutstanding: result.newOutstanding,
      availableBalance: result.balanceAfter,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Order advance-payment POST error:", error);
    return NextResponse.json({ error: "Failed to apply advance balance" }, { status: 500 });
  }
}

// Transaction-scoped variant of computeOrderOutstandingAmount — reads
// through the SAME `tx` client used for the row lock above so the
// outstanding amount reflects any ledger row written earlier in this same
// transaction and is never a stale pre-lock read.
async function computeOrderOutstandingAmountTx(tx: any, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { totalAmount: true } });
  const entries = await tx.customerAdvanceTransaction.findMany({
    where: { orderId, type: { in: ["ORDER_PAYMENT", "REFUND", "REVERSAL"] } },
    select: { type: true, amount: true },
  });

  let advanceApplied = 0;
  for (const entry of entries) {
    const amt = Number(entry.amount);
    if (entry.type === "ORDER_PAYMENT") advanceApplied += amt;
    else advanceApplied -= amt;
  }

  const totalAmount = Number(order.totalAmount);
  const outstanding = Math.max(0, Math.round((totalAmount - advanceApplied) * 100) / 100);
  return { totalAmount, advanceApplied, outstanding };
}
