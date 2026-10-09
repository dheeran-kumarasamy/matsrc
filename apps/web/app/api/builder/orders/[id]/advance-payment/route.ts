import { NextResponse } from "next/server";
import { PaymentStatus } from "@matsrc/db";
import {
  lockAdvanceAccountRow,
  upsertAdvanceReservation,
  consumeAdvanceReservation,
  AdvanceReservationError,
} from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { computeOrderOutstandingAmount } from "@/lib/order-outstanding";

export const dynamic = "force-dynamic";

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

    const { totalAmount, advanceApplied, outstanding, activeReservationAmount } = await computeOrderOutstandingAmount(
      order.id
    );

    const account = await prisma.customerAdvanceAccount.findUnique({
      where: { buyerId: user.id },
      select: { availableBalance: true, status: true },
    });

    return NextResponse.json({
      totalAmount,
      advanceApplied,
      outstanding,
      // Still-pending commitment (RESERVED, not yet settled) — surfaced
      // separately so the UI can show "Advance Reserved" rather than
      // implying the money has already been permanently spent.
      advanceReserved: activeReservationAmount,
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
// Buyer EXPLICITLY opts in to RESERVING some/all of their Buildohub Advance
// Balance toward this order's outstanding amount. This NO LONGER
// permanently debits the buyer — it moves the requested amount from
// AVAILABLE to RESERVED (see packages/db/lib/advance-ledger.ts's
// upsertAdvanceReservation). The amount is only genuinely, permanently
// spent once the order's overall payment is confirmed — see
// PaymentsService.approve (apps/api) for the settlement event that
// consumes the reservation — or, for orders with no remaining external
// payment at all, immediately below.
//
// The default order-payment screen never calls this route automatically —
// it is only ever invoked after the buyer selects "Use Advance Balance =
// Yes" and enters an amount.
//
// Idempotent: posting the exact same amount again for the same order is a
// true no-op (handles double-click/refresh/network retry). Posting a
// different amount adjusts the existing reservation (reserves more /
// releases the difference) rather than creating a duplicate.
//
// Server-side authoritative validation (never trusts the frontend):
//   amount >= 0
//   amount <= current available balance (re-read inside a locked transaction)
//   amount <= order's current outstanding amount (re-computed server-side)
//
// Concurrency: the CustomerAdvanceAccount row is locked
// (`SELECT ... FOR UPDATE`) inside the same `$transaction` that both
// re-validates the balance and writes the ADVANCE_RESERVATION/
// ADVANCE_RELEASE ledger entry, so two concurrent orders can never
// over-reserve the same advance balance.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const body = await request.json().catch(() => ({}));
    const amount = Number(body?.amount);

    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: "Advance amount must be a positive number" }, { status: 400 });
    }
    if (Math.round(amount * 100) !== amount * 100) {
      return NextResponse.json({ error: "Amount cannot have more than 2 decimal places" }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, paymentStatus: true, status: true, enquiryId: true, orderNumber: true, totalAmount: true },
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
      // Lock the advance account row FIRST so a concurrent reservation
      // against the same account (e.g. a second order's payment, or a
      // second tab) can never read a stale balance — see spec §27
      // Concurrency Protection.
      const locked = await lockAdvanceAccountRow(tx as any, account.id);
      const currentAvailable = Number(locked.availableBalance);
      const currentReserved = Number(locked.reservedBalance);

      // Re-read the order's outstanding amount from WITHIN the same locked
      // transaction — never trust a value computed before the lock, or any
      // value supplied by the client. maxReservable excludes this order's
      // own currently-active reservation, so raising the reservation up to
      // the full outstanding amount is actually possible.
      const { outstanding: maxReservable } = await computeSettledOutstandingTx(tx, order.id, Number(order.totalAmount));

      const { availableAfter, reservedAfter } = await upsertAdvanceReservation(tx as any, {
        accountId: account.id,
        buyerId: user.id,
        orderId: order.id,
        targetAmount: amount,
        maxReservable,
        currentAvailable,
        currentReserved,
        createdBy: user.id,
        reference: order.enquiryId ?? order.orderNumber ?? order.id,
      });

      const newOutstanding = Math.max(0, Math.round((maxReservable - amount) * 100) / 100);

      // Full-advance special case (spec §12/§23): if the reservation now
      // covers the ENTIRE outstanding amount, there is no external payment
      // left to wait for — consume it immediately, atomically, in the same
      // transaction, and mark the order PAID. This is the one case where
      // reserve -> consume happens in a single step, because there is no
      // separate settlement event to wait for.
      if (newOutstanding === 0 && amount > 0) {
        const settled = await consumeAdvanceReservation(tx as any, {
          orderId: order.id,
          createdBy: user.id,
          reference: order.enquiryId ?? order.orderNumber ?? order.id,
          currentAvailable: availableAfter,
          currentReserved: reservedAfter,
        });

        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: PaymentStatus.PAID } });
        await tx.orderTracking.create({
          data: { orderId: order.id, status: "PROCESSING" as any, note: "Order fully paid using Buildohub Advance Balance" },
        });

        return {
          availableAfter: settled?.availableAfter ?? availableAfter,
          reservedAfter: settled?.reservedAfter ?? reservedAfter,
          newOutstanding: 0,
          consumed: true,
        };
      }

      return { availableAfter, reservedAfter, newOutstanding, consumed: false };
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: result.consumed ? "ADVANCE_RESERVATION_CONSUMED" : "ADVANCE_RESERVATION_UPDATED",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          amount,
          availableAfter: result.availableAfter,
          reservedAfter: result.reservedAfter,
          newOutstanding: result.newOutstanding,
        },
      },
    });

    return NextResponse.json({
      advanceApplied: amount,
      remainingOutstanding: result.newOutstanding,
      availableBalance: result.availableAfter,
      // True once the order has already been fully settled by this
      // reservation (full-advance case) — false for a partial reservation
      // still awaiting the remaining external payment.
      settled: result.consumed,
    });
  } catch (error) {
    if (error instanceof AdvanceReservationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Order advance-payment POST error:", error);
    return NextResponse.json({ error: "Failed to apply advance balance" }, { status: 500 });
  }
}

// Transaction-scoped helper: computes the order's outstanding amount from
// SETTLED ledger movements only (ORDER_PAYMENT/REFUND/REVERSAL),
// deliberately EXCLUDING this order's own currently-active reservation (if
// any) — the caller (upsertAdvanceReservation) handles the
// previous-reservation-amount delta itself, so passing an outstanding
// figure that already subtracted the existing reservation would
// double-count it. Reads through the SAME `tx` client used for the row
// lock above.
async function computeSettledOutstandingTx(tx: any, orderId: string, totalAmount: number) {
  const entries = await tx.customerAdvanceTransaction.findMany({
    where: { orderId, type: { in: ["ORDER_PAYMENT", "REFUND", "REVERSAL"] } },
    select: { type: true, amount: true },
  });

  let settledApplied = 0;
  for (const entry of entries) {
    const amt = Number(entry.amount);
    if (entry.type === "ORDER_PAYMENT") settledApplied += amt;
    else settledApplied -= amt;
  }

  const outstanding = Math.max(0, Math.round((totalAmount - settledApplied) * 100) / 100);
  return { outstanding };
}
