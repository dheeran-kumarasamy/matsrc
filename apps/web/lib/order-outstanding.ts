import { prisma } from "@/lib/builder-db";
import { assertConsistentOrderSnapshot, assertConsistentOrderSnapshotArithmetic, calculateRemainingBalance } from "@matsrc/db";

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
// Product-Level GST / GST-Inclusive Buyer Payable (Phase 4): the "payable"
// figure this function bases `outstanding` on is now
// `Order.finalPayableAmount` (the frozen, GST-inclusive snapshot written at
// supplier confirmation — see packages/db/lib/order-confirmation-snapshot.ts)
// when present, falling back to the pre-existing `Order.totalAmount`
// (GST-exclusive) for any order that has not yet been confirmed through one
// of the snapshot-writing paths, or that predates this feature entirely.
// This is an explicit, reviewed compatibility strategy — never an inferred
// one: a null finalPayableAmount is read as "no GST-inclusive snapshot
// exists for this order yet", NEVER as "GST is zero", and the admin's
// CURRENT GST/markup configuration is never consulted here to backfill a
// historical order's tax — see this module's own "legacy order" tests.
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
    select: {
      totalAmount: true,
      taxAmount: true,
      finalPayableAmount: true,
      advancePercent: true,
      requiredAdvanceAmount: true,
    },
  });
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Fail safely on a partially-populated snapshot rather than silently
  // picking a value — reuses the SAME invariant the confirmation-path
  // writers themselves enforce (packages/db/lib/order-confirmation-snapshot.ts),
  // so this read-side check can never drift from the write-side contract.
  // A genuinely inconsistent row here means the confirmation-path writer
  // itself has a defect — this function must never guess which half to
  // trust or silently repair it.
  assertConsistentOrderSnapshot(orderId, {
    taxAmount: order.taxAmount == null ? null : Number(order.taxAmount),
    finalPayableAmount: order.finalPayableAmount == null ? null : Number(order.finalPayableAmount),
    advancePercent: order.advancePercent == null ? null : Number(order.advancePercent),
    requiredAdvanceAmount: order.requiredAdvanceAmount == null ? null : Number(order.requiredAdvanceAmount),
  });
  const payableSet = order.finalPayableAmount != null;

  // Phase 4.4 — additionally validate the ARITHMETIC of a confirmed
  // snapshot before returning any payable/outstanding figure derived from
  // it, using the totalAmount already selected above (no extra query).
  // Never run for a legacy/unconfirmed order (finalPayableAmount null) —
  // nothing to reconcile, and this must never recompute historical
  // GST/markup from current configuration.
  if (payableSet) {
    assertConsistentOrderSnapshotArithmetic(orderId, {
      subtotal: Number(order.totalAmount),
      taxAmount: Number(order.taxAmount),
      finalPayableAmount: Number(order.finalPayableAmount),
      advancePercent: order.advancePercent == null ? null : Number(order.advancePercent),
      requiredAdvanceAmount: order.requiredAdvanceAmount == null ? null : Number(order.requiredAdvanceAmount),
    });
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

  // Product-Level GST / GST-Inclusive Buyer Payable (Phase 4): prefer the
  // frozen, GST-inclusive finalPayableAmount when this order has been
  // confirmed through a snapshot-writing path; fall back to the pre-existing
  // GST-exclusive totalAmount for a legacy/not-yet-confirmed order. Never
  // recomputed from current GST/markup configuration.
  const payableAmount = payableSet ? Number(order.finalPayableAmount) : Number(order.totalAmount ?? 0);
  const outstanding = calculateRemainingBalance(payableAmount, advanceApplied);

  return { totalAmount: payableAmount, advanceApplied, outstanding, activeReservationAmount };
}
