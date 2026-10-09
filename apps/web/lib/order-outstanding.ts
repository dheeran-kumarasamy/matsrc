import { prisma } from "@/lib/builder-db";

// Server-side authoritative computation of an order's outstanding
// (still-payable-via-external-method) amount, accounting for any Buildohub
// Advance Balance committed toward it — whether that commitment is a
// still-ACTIVE reservation (not yet settled) or an already-CONSUMED one
// (settlement confirmed). NEVER trust a frontend-computed outstanding
// amount — this is the single source of truth both the advance-reservation
// route (apps/web/app/api/builder/orders/[id]/advance-payment/route.ts) and
// the existing bank-transfer payment-proof route
// (apps/web/app/api/builder/orders/[id]/payment-proof/route.ts) must read
// from.
//
// advanceApplied = sum(ORDER_PAYMENT ledger entries for this order — money
//                  already genuinely consumed/settled)
//                - sum(REFUND/REVERSAL entries for this order)
//                + the order's ACTIVE AdvanceReservation amount, if any
//                  (money committed but not yet settled — still must not be
//                  asked for again via the external payment method).
//
// A reservation that has been CONSUMED is deliberately NOT added a second
// time here — its amount is already reflected via the ORDER_PAYMENT ledger
// entry written at consumption time (see consumeAdvanceReservation).
export async function computeOrderOutstandingAmount(orderId: string): Promise<{
  totalAmount: number;
  advanceApplied: number;
  outstanding: number;
  activeReservationAmount: number;
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { totalAmount: true },
  });
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const [entries, reservation] = await Promise.all([
    prisma.customerAdvanceTransaction.findMany({
      where: { orderId, type: { in: ["ORDER_PAYMENT", "REFUND", "REVERSAL"] } },
      select: { type: true, amount: true },
    }),
    prisma.advanceReservation.findUnique({
      where: { orderId },
      select: { amount: true, status: true },
    }),
  ]);

  let advanceApplied = 0;
  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.type === "ORDER_PAYMENT") advanceApplied += amount;
    else advanceApplied -= amount; // REFUND/REVERSAL give the amount back
  }

  const activeReservationAmount = reservation && reservation.status === "ACTIVE" ? Number(reservation.amount) : 0;
  advanceApplied += activeReservationAmount;

  const totalAmount = Number(order.totalAmount);
  const outstanding = Math.max(0, Math.round((totalAmount - advanceApplied) * 100) / 100);

  return { totalAmount, advanceApplied, outstanding, activeReservationAmount };
}
