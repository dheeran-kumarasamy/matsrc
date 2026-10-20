// packages/db/lib/order-dispatch-eligibility.ts
//
// Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
// Dispatch — the single, shared, database-reading orchestration layer both
// apps/supplier (Next.js, updateSupplierOrderStatus) and apps/api (NestJS,
// OrdersService.updateStatus) call before allowing a PROCESSING ->
// DISPATCHED transition, so there is exactly one place this decision is
// computed — mirrors the existing convention already established by
// order-confirmation-snapshot.ts (shared between the same two call sites
// for the GST/markup confirmation freeze).
//
// Gate enforced (PROCESSING -> DISPATCHED only — every other transition is
// unaffected):
//   1. A SupplierInvoice exists for this order.
//   2. Its status is CONFIRMED (never PENDING_REVIEW/REJECTED).
//   3. The order has not been REFUNDED (a refunded order must never ship).
//   4. The amount actually, verifiably SETTLED against this order (see
//      calculateOrderSettledAmount below) covers the Admin-confirmed,
//      freight/other-charges-inclusive final payable amount
//      (SupplierInvoice.confirmedTotalAmount) within a one-cent tolerance.
//
// WHY Order.paymentStatus === "PAID" ALONE IS NEVER SUFFICIENT:
// paymentStatus is set to PAID the moment the buyer's payment is verified
// against whatever the payable amount was AT THAT TIME (see
// PaymentsService.approve / the advance-payment route's full-settlement
// branch) — almost always the PRE-CONFIRMATION estimate
// (Order.finalPayableAmount), since today's workflow collects payment
// before any Admin has reviewed freight/other charges. If an Admin later
// confirms a SupplierInvoice whose confirmedTotalAmount is HIGHER than
// what was actually collected, paymentStatus remains stuck at its
// already-true PAID value even though a real outstanding balance now
// exists — exactly the stale-flag bug this feature must not reproduce.
// This module therefore independently RECOMPUTES the settled amount from
// the authoritative ledger/verification records every time, rather than
// ever trusting the cached paymentStatus flag as proof of full settlement.
import { roundCurrency } from "./gst-calculation";

const SETTLEMENT_TOLERANCE = 0.01;

export type DispatchEligibilityOrderStatus = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
export type DispatchEligibilityPaymentStatus = "PENDING" | "PENDING_VERIFICATION" | "PAID" | "FAILED" | "REFUNDED";
export type DispatchEligibilitySupplierInvoiceStatus = "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";

export type OrderDispatchEligibilityTxClient = {
  order: {
    findUnique: (args: any) => Promise<{
      id: string;
      paymentStatus: DispatchEligibilityPaymentStatus;
      totalAmount: unknown;
      finalPayableAmount: unknown;
      supplierInvoice: {
        status: DispatchEligibilitySupplierInvoiceStatus;
        confirmedTotalAmount: unknown;
      } | null;
    } | null>;
  };
  customerAdvanceTransaction: {
    findMany: (args: any) => Promise<Array<{ type: string; amount: unknown }>>;
  };
  paymentVerification: {
    findUnique: (args: any) => Promise<{ status: string; amount: unknown } | null>;
  };
};

export type OrderDispatchEligibilityResult =
  | { eligible: true; finalPayableAmount: number; settledAmount: number }
  | { eligible: false; reason: string; finalPayableAmount: number | null; settledAmount: number };

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/**
 * Computes the amount actually, verifiably settled against an order from
 * the two independent authoritative sources of truth already established
 * elsewhere in this codebase — never a third, competing ledger:
 *   - Buildohub Advance Balance: CustomerAdvanceTransaction ORDER_PAYMENT
 *     entries (money genuinely consumed/settled via advance), net of any
 *     REFUND/REVERSAL — identical math to
 *     apps/web/lib/order-outstanding.ts's computeOrderOutstandingAmount
 *     and the advance-payment route's computeSettledOutstandingTx.
 *   - Bank-transfer: PaymentVerification.amount, counted ONLY while
 *     status === "APPROVED" (a PENDING/REJECTED proof is never counted as
 *     settled funds — this is the authoritative fix for "pending/
 *     unverified bank-transfer proofs must not count as settled funds").
 * CREDIT-method orders that reach full settlement go through the exact
 * same advance-payment route's full-settlement branch (see
 * apps/web/app/api/builder/orders/[id]/advance-payment/route.ts), which
 * itself writes an ORDER_PAYMENT ledger entry — so CREDIT settlement is
 * already covered by the advance-ledger sum above without a third branch.
 */
export async function calculateOrderSettledAmount(tx: OrderDispatchEligibilityTxClient, orderId: string): Promise<number> {
  const [ledgerEntries, verification] = await Promise.all([
    tx.customerAdvanceTransaction.findMany({
      where: { orderId, type: { in: ["ORDER_PAYMENT", "REFUND", "REVERSAL"] } },
      select: { type: true, amount: true },
    }),
    tx.paymentVerification.findUnique({
      where: { orderId },
      select: { status: true, amount: true },
    }),
  ]);

  let settled = 0;
  for (const entry of ledgerEntries) {
    const amount = toNumber(entry.amount);
    if (entry.type === "ORDER_PAYMENT") settled += amount;
    else settled -= amount; // REFUND/REVERSAL give the amount back
  }

  if (verification && verification.status === "APPROVED") {
    settled += toNumber(verification.amount);
  }

  return roundCurrency(settled);
}

/**
 * The single authoritative PROCESSING -> DISPATCHED eligibility check —
 * see this module's top doc comment for the full gate definition. Returns
 * a discriminated result (never throws for an ordinary ineligibility —
 * only a genuinely missing order resolves to `eligible: false` with a
 * generic reason, which the caller is expected to have already validated
 * exists before calling this).
 */
export async function checkOrderDispatchEligibility(
  tx: OrderDispatchEligibilityTxClient,
  orderId: string
): Promise<OrderDispatchEligibilityResult> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      paymentStatus: true,
      totalAmount: true,
      finalPayableAmount: true,
      supplierInvoice: { select: { status: true, confirmedTotalAmount: true } },
    } as any,
  });

  if (!order) {
    return { eligible: false, reason: "Order not found", finalPayableAmount: null, settledAmount: 0 };
  }

  if (!order.supplierInvoice) {
    return {
      eligible: false,
      reason:
        "The supplier has not yet uploaded an invoice for this order — it cannot be dispatched until an Admin has reviewed and confirmed the freight/other charges.",
      finalPayableAmount: null,
      settledAmount: 0,
    };
  }

  if (order.supplierInvoice.status === "PENDING_REVIEW") {
    return {
      eligible: false,
      reason:
        "The supplier invoice is still awaiting Admin review — it cannot be dispatched until the freight/other charges are confirmed.",
      finalPayableAmount: null,
      settledAmount: 0,
    };
  }

  if (order.supplierInvoice.status === "REJECTED") {
    return {
      eligible: false,
      reason:
        "The supplier invoice was rejected by the Admin — a corrected invoice must be uploaded and confirmed before this order can be dispatched.",
      finalPayableAmount: null,
      settledAmount: 0,
    };
  }

  if (order.paymentStatus === "REFUNDED") {
    return {
      eligible: false,
      reason: "This order has been refunded and cannot be dispatched.",
      finalPayableAmount: null,
      settledAmount: 0,
    };
  }

  const confirmedTotalAmount = toNumber(order.supplierInvoice.confirmedTotalAmount);
  const settledAmount = await calculateOrderSettledAmount(tx, orderId);
  const outstanding = roundCurrency(confirmedTotalAmount - settledAmount);

  if (outstanding > SETTLEMENT_TOLERANCE) {
    return {
      eligible: false,
      reason: `The confirmed final payable amount (\u20b9${confirmedTotalAmount.toFixed(2)}) has not been fully paid \u2014 \u20b9${outstanding.toFixed(2)} is still outstanding.`,
      finalPayableAmount: confirmedTotalAmount,
      settledAmount,
    };
  }

  return { eligible: true, finalPayableAmount: confirmedTotalAmount, settledAmount };
}
