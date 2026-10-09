import { prisma } from "@/lib/builder-db";

// Server-side authoritative computation of an order's outstanding
// (still-payable) amount, accounting for any Buildohub Advance Balance
// already applied toward it. NEVER trust a frontend-computed outstanding
// amount — this is the single source of truth both the advance-debit route
// (apps/web/app/api/builder/orders/[id]/advance-payment/route.ts) and the
// existing bank-transfer payment-proof route
// (apps/web/app/api/builder/orders/[id]/payment-proof/route.ts) must read
// from.
//
// outstanding = totalAmount - sum(ORDER_PAYMENT ledger entries for this
// order that have not been reversed). REFUND/REVERSAL entries referencing
// this order add back to the outstanding amount (e.g. after a cancellation
// reverses an earlier advance debit).
export async function computeOrderOutstandingAmount(orderId: string): Promise<{
  totalAmount: number;
  advanceApplied: number;
  outstanding: number;
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { totalAmount: true },
  });
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const entries = await prisma.customerAdvanceTransaction.findMany({
    where: { orderId, type: { in: ["ORDER_PAYMENT", "REFUND", "REVERSAL"] } },
    select: { type: true, amount: true },
  });

  let advanceApplied = 0;
  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.type === "ORDER_PAYMENT") advanceApplied += amount;
    else advanceApplied -= amount; // REFUND/REVERSAL give the amount back
  }

  const totalAmount = Number(order.totalAmount);
  const outstanding = Math.max(0, Math.round((totalAmount - advanceApplied) * 100) / 100);

  return { totalAmount, advanceApplied, outstanding };
}
