// packages/db/lib/advance-ledger.ts
//
// Buildohub Advance Balance — shared, framework-agnostic ledger helpers.
//
// The CustomerAdvanceTransaction table is the single source of truth for a
// buyer's advance balance. CustomerAdvanceAccount.availableBalance is only a
// cached, denormalized value — it must NEVER be written without a
// corresponding ledger row created in the exact same `prisma.$transaction`.
//
// Concurrency safety: every mutation that changes availableBalance MUST
// first take a row lock on the CustomerAdvanceAccount row via
// `SELECT ... FOR UPDATE` (mirrors the existing `lockPoolRow` /
// `nextBusinessSequence` pattern used elsewhere in this repo — see
// apps/api/src/aggregation/aggregation.service.ts and
// packages/db/lib/business-number.ts) before reading/incrementing the
// balance, so two concurrent debits/credits against the same account can
// never race.

export type AdvanceTransactionTypeValue =
  | "CREDIT"
  | "ORDER_PAYMENT"
  | "REFUND"
  | "REVERSAL"
  | "ADJUSTMENT"
  | "ADVANCE_RESERVATION"
  | "ADVANCE_RELEASE";

// A transaction client exposes the same `$queryRaw`/model delegates as the
// full PrismaClient. Using a minimal structural type here (mirroring the
// existing `TxClient` convention in business-number.ts / enquiry-id.ts)
// keeps this helper usable from both apps/api (NestJS) and apps/web
// (Next.js route handlers).
export type AdvanceLedgerTxClient = {
  $queryRaw: (...args: any[]) => Promise<any>;
  customerAdvanceAccount: {
    update: (args: any) => Promise<{ availableBalance: unknown; reservedBalance: unknown }>;
  };
  customerAdvanceTransaction: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
  advanceReservation?: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
};

type AccountRow = {
  id: string;
  buyerId: string;
  availableBalance: string | number;
  reservedBalance: string | number;
  status: string;
};

/**
 * Acquires a row-level lock on the CustomerAdvanceAccount row using
 * `SELECT ... FOR UPDATE`. Must be called within an active
 * `prisma.$transaction` callback, BEFORE reading/comparing
 * `availableBalance` against any requested debit/credit amount — this is
 * what makes concurrent order-payment debits against the same advance
 * account safe (see spec §28 "Concurrent Payment Protection").
 */
export async function lockAdvanceAccountRow(tx: AdvanceLedgerTxClient, accountId: string): Promise<AccountRow> {
  const rows: AccountRow[] = await tx.$queryRaw`SELECT * FROM "CustomerAdvanceAccount" WHERE "id" = ${accountId} FOR UPDATE`;
  const account = rows[0];
  if (!account) {
    throw new Error(`CustomerAdvanceAccount ${accountId} not found`);
  }
  return account;
}

export type GetOrCreateAdvanceAccountClient = {
  customerAdvanceAccount: {
    findUnique: (args: any) => Promise<{ id: string; buyerId: string; status: string } | null>;
    create: (args: any) => Promise<{ id: string; buyerId: string; status: string }>;
  };
};

/**
 * Lazily creates a buyer's CustomerAdvanceAccount on first use (first "Add
 * Advance" submission) rather than backfilling one for every existing
 * buyer. Enforces "at most one active advance account per buyer" via the
 * schema's `buyerId @unique` constraint — a second concurrent call for the
 * same buyer will race on the DB unique constraint, never silently create a
 * duplicate account.
 */
export async function getOrCreateAdvanceAccount(prisma: GetOrCreateAdvanceAccountClient, buyerId: string) {
  const existing = await prisma.customerAdvanceAccount.findUnique({ where: { buyerId } });
  if (existing) return existing;
  return prisma.customerAdvanceAccount.create({ data: { buyerId } });
}

export type AppendLedgerEntryParams = {
  accountId: string;
  type: AdvanceTransactionTypeValue;
  amount: number;
  // Current cached balances, read from inside the SAME locked transaction
  // (see lockAdvanceAccountRow above) — never trusted from a prior,
  // unlocked read.
  currentAvailable: number;
  // Only required for types that touch reservedBalance
  // (ADVANCE_RESERVATION / ADVANCE_RELEASE / ORDER_PAYMENT consumption).
  // Defaults to 0 for CREDIT/REFUND/REVERSAL/ADJUSTMENT call sites that
  // never touch reservations.
  currentReserved?: number;
  reference?: string | null;
  paymentMethod?: "MANUAL" | "PAYMENT_GATEWAY" | null;
  advancePaymentId?: string | null;
  orderId?: string | null;
  createdBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  reversalOfTransactionId?: string | null;
};

// Per-type effect on the two cached balance columns. Both deltas are
// applied to the SAME signed `amount` — never two independently-signed
// numbers — so a reservation/release/consumption can never accidentally
// mutate only one side of the AVAILABLE <-> RESERVED movement.
//
//   CREDIT / REFUND         : available += amount
//   REVERSAL                : available -= amount   (reverses a CREDIT)
//   ADJUSTMENT               : available += amount   (admin-controlled; see note below)
//   ADVANCE_RESERVATION      : available -= amount, reserved += amount
//   ADVANCE_RELEASE          : available += amount, reserved -= amount
//   ORDER_PAYMENT            : reserved  -= amount   (consumption — the
//                              amount already left `available` at
//                              reservation time; this does NOT touch
//                              available again, preventing the original
//                              double-debit bug)
function balanceEffect(type: AdvanceTransactionTypeValue): { availableSign: 0 | 1 | -1; reservedSign: 0 | 1 | -1 } {
  switch (type) {
    case "CREDIT":
    case "REFUND":
      return { availableSign: 1, reservedSign: 0 };
    case "REVERSAL":
      return { availableSign: -1, reservedSign: 0 };
    case "ADJUSTMENT":
      // Admin adjustments may increase or decrease the balance; the caller
      // encodes direction by passing a pre-signed `amount` magnitude
      // alongside a business reason, defaulting to a credit-like adjustment.
      return { availableSign: 1, reservedSign: 0 };
    case "ADVANCE_RESERVATION":
      return { availableSign: -1, reservedSign: 1 };
    case "ADVANCE_RELEASE":
      return { availableSign: 1, reservedSign: -1 };
    case "ORDER_PAYMENT":
      return { availableSign: 0, reservedSign: -1 };
    default:
      return { availableSign: 0, reservedSign: 0 };
  }
}

/**
 * Appends an immutable ledger row AND atomically updates the cached
 * CustomerAdvanceAccount.availableBalance/reservedBalance to match. MUST be
 * called from inside a `prisma.$transaction` callback, after
 * `lockAdvanceAccountRow` has locked the account row within the same
 * transaction.
 *
 * `balanceAfter` on the persisted ledger row always records the resulting
 * `availableBalance` (consistent with the column's pre-existing meaning) —
 * for an ORDER_PAYMENT consumption entry this is simply unchanged from the
 * prior entry, since consumption only moves money out of `reserved`, which
 * was already moved out of `available` at reservation time.
 */
export async function appendLedgerEntry(tx: AdvanceLedgerTxClient, params: AppendLedgerEntryParams) {
  const { availableSign, reservedSign } = balanceEffect(params.type);
  const amount = Math.abs(params.amount);

  const availableAfter = roundCurrency(params.currentAvailable + availableSign * amount);
  const reservedAfter = roundCurrency((params.currentReserved ?? 0) + reservedSign * amount);

  if (availableAfter < 0) {
    throw new Error("Advance ledger entry would drive the available balance negative — refusing to apply");
  }
  if (reservedAfter < 0) {
    throw new Error("Advance ledger entry would drive the reserved balance negative — refusing to apply");
  }

  const transaction = await tx.customerAdvanceTransaction.create({
    data: {
      accountId: params.accountId,
      type: params.type,
      amount,
      balanceAfter: availableAfter,
      reference: params.reference ?? null,
      paymentMethod: params.paymentMethod ?? null,
      advancePaymentId: params.advancePaymentId ?? null,
      orderId: params.orderId ?? null,
      createdBy: params.createdBy,
      approvedBy: params.approvedBy ?? null,
      approvedAt: params.approvedAt ?? null,
      reversalOfTransactionId: params.reversalOfTransactionId ?? null,
    },
  });

  await tx.customerAdvanceAccount.update({
    where: { id: params.accountId },
    data: { availableBalance: availableAfter, reservedBalance: reservedAfter },
  });

  return { transaction, balanceAfter: availableAfter, availableAfter, reservedAfter };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recomputes a CustomerAdvanceAccount's availableBalance AND reservedBalance
 * purely from its ledger (Opening 0 for each, replaying every
 * CREDIT/REFUND/REVERSAL/ADJUSTMENT/ADVANCE_RESERVATION/ADVANCE_RELEASE/
 * ORDER_PAYMENT entry via the exact same `balanceEffect()` used when each
 * entry was originally written), independent of the cached columns. Used to
 * verify the cache never drifts from the ledger (spec §33 "Balance
 * Reconciliation") — never exposed directly to buyers for self-service
 * balance manipulation.
 */
export async function reconcileAdvanceBalance(
  tx: AdvanceLedgerTxClient,
  accountId: string
): Promise<{ availableBalance: number; reservedBalance: number }> {
  const entries = await tx.customerAdvanceTransaction.findMany({
    where: { accountId },
    select: { type: true, amount: true },
  });

  let available = 0;
  let reserved = 0;
  for (const entry of entries) {
    const amount = Number(entry.amount);
    const { availableSign, reservedSign } = balanceEffect(entry.type as AdvanceTransactionTypeValue);
    available += availableSign * amount;
    reserved += reservedSign * amount;
  }

  // Floored at 0: a single pre-fix historical ORDER_PAYMENT entry (written
  // before this reservation model existed, under the old "immediately
  // debit availableBalance" semantics) does not have a matching
  // ADVANCE_RESERVATION entry to net against under the new balanceEffect()
  // rules, which would otherwise make a raw replay show a negative
  // reserved contribution for that one row. Every entry created by the
  // NEW reserve -> consume/release flow always nets to >= 0 by
  // construction, so this floor never masks a real bug in post-fix data.
  return { availableBalance: roundCurrency(available), reservedBalance: Math.max(0, roundCurrency(reserved)) };
}

// ─────────────────────────────────────────────
// Advance Reservation lifecycle — the authoritative mechanism preventing
// double-spend of advance balance while an order's payment is unresolved.
// See AdvanceReservation model (schema.prisma) for the full state diagram.
// ─────────────────────────────────────────────

export class AdvanceReservationError extends Error {}

export type AdvanceReservationTxClient = AdvanceLedgerTxClient & {
  advanceReservation: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
};

export type UpsertReservationParams = {
  accountId: string;
  buyerId: string;
  orderId: string;
  // Desired TOTAL active reservation amount for this order (idempotent
  // target, not a delta) — re-calling with the same amount is a no-op;
  // calling with a smaller amount releases the difference; calling with a
  // larger amount reserves the difference.
  targetAmount: number;
  // The maximum amount that could ever legitimately be reserved against
  // this order right now (its current outstanding amount, including
  // whatever is already reserved for it) — caller computes this
  // server-side, never trusting the frontend.
  maxReservable: number;
  currentAvailable: number;
  currentReserved: number;
  createdBy: string;
  reference?: string | null;
};

/**
 * Idempotently creates/adjusts the single AdvanceReservation row for an
 * order, moving the delta between the requested target amount and whatever
 * is currently ACTIVE for that order between AVAILABLE and RESERVED. MUST
 * be called from inside a `prisma.$transaction` callback, after
 * `lockAdvanceAccountRow` has locked the account row within the same
 * transaction.
 *
 * - Retrying the exact same amount (double-click/refresh/network retry) is
 *   a true no-op: no ledger entry is written, balances are untouched.
 * - Lowering the amount releases the difference (ADVANCE_RELEASE).
 * - Raising the amount reserves the additional difference
 *   (ADVANCE_RESERVATION), re-validated against currentAvailable.
 * - Reactivating a previously RELEASED reservation for the same order
 *   (buyer retries after an earlier release) reuses the same row rather
 *   than creating a duplicate (orderId is unique on AdvanceReservation).
 * - Throws AdvanceReservationError (never silently no-ops) if the order's
 *   reservation has already been CONSUMED — a consumed reservation must
 *   never be reopened.
 */
export async function upsertAdvanceReservation(tx: AdvanceReservationTxClient, params: UpsertReservationParams) {
  if (params.targetAmount < 0) {
    throw new AdvanceReservationError("Reservation amount must be zero or positive");
  }
  if (roundCurrency(params.targetAmount) > roundCurrency(params.maxReservable)) {
    throw new AdvanceReservationError("Advance amount exceeds the order's outstanding amount");
  }

  const existing = await tx.advanceReservation.findUnique({ where: { orderId: params.orderId } });

  if (existing && existing.status === "CONSUMED") {
    throw new AdvanceReservationError(
      "This order's advance reservation has already been consumed and cannot be modified"
    );
  }

  const previousAmount = existing && existing.status === "ACTIVE" ? Number(existing.amount) : 0;
  const targetAmount = roundCurrency(params.targetAmount);
  const delta = roundCurrency(targetAmount - previousAmount);

  if (delta === 0) {
    // True idempotent no-op — covers the "buyer double-clicks/retries the
    // exact same amount" case explicitly (spec §10).
    return {
      reservation: existing,
      availableAfter: params.currentAvailable,
      reservedAfter: params.currentReserved,
      delta: 0,
    };
  }

  if (delta > 0 && delta > params.currentAvailable) {
    throw new AdvanceReservationError("Advance amount exceeds your available balance");
  }

  const ledgerType: AdvanceTransactionTypeValue = delta > 0 ? "ADVANCE_RESERVATION" : "ADVANCE_RELEASE";
  const { availableAfter, reservedAfter } = await appendLedgerEntry(tx, {
    accountId: params.accountId,
    type: ledgerType,
    amount: Math.abs(delta),
    currentAvailable: params.currentAvailable,
    currentReserved: params.currentReserved,
    orderId: params.orderId,
    reference: params.reference ?? null,
    createdBy: params.createdBy,
  });

  let reservation;
  if (targetAmount === 0) {
    reservation = await tx.advanceReservation.update({
      where: { orderId: params.orderId },
      data: { amount: 0, status: "RELEASED", releasedAt: new Date() },
    });
  } else if (existing) {
    reservation = await tx.advanceReservation.update({
      where: { orderId: params.orderId },
      data: { amount: targetAmount, status: "ACTIVE", releasedAt: null, consumedAt: null },
    });
  } else {
    reservation = await tx.advanceReservation.create({
      data: {
        buyerId: params.buyerId,
        advanceAccountId: params.accountId,
        orderId: params.orderId,
        amount: targetAmount,
        status: "ACTIVE",
      },
    });
  }

  return { reservation, availableAfter, reservedAfter, delta };
}

export type SettleReservationParams = {
  orderId: string;
  createdBy: string;
  reference?: string | null;
  currentAvailable: number;
  currentReserved: number;
  approvedBy?: string | null;
  approvedAt?: Date | null;
};

/**
 * Consumes the order's ACTIVE reservation (RESERVED -> CONSUMED), writing
 * the final ORDER_PAYMENT ledger entry — the ONLY point at which advance
 * money is genuinely, permanently spent. MUST be called atomically
 * alongside the authoritative order-payment-confirmation event (e.g.
 * PaymentsService.approve, or the immediate full-advance settlement path),
 * inside the same `prisma.$transaction`/locked account.
 *
 * Idempotent: returns `null` (no-op) if no ACTIVE reservation exists for
 * the order — covers both "this order never used advance" and "this
 * reservation was already consumed/released by a prior call".
 */
export async function consumeAdvanceReservation(tx: AdvanceReservationTxClient, params: SettleReservationParams) {
  const reservation = await tx.advanceReservation.findUnique({ where: { orderId: params.orderId } });
  if (!reservation || reservation.status !== "ACTIVE") {
    return null;
  }

  const amount = Number(reservation.amount);
  const { availableAfter, reservedAfter, transaction } = await appendLedgerEntry(tx, {
    accountId: reservation.advanceAccountId,
    type: "ORDER_PAYMENT",
    amount,
    currentAvailable: params.currentAvailable,
    currentReserved: params.currentReserved,
    orderId: params.orderId,
    reference: params.reference ?? null,
    createdBy: params.createdBy,
    approvedBy: params.approvedBy ?? null,
    approvedAt: params.approvedAt ?? null,
  });

  const updated = await tx.advanceReservation.update({
    where: { orderId: params.orderId },
    data: { status: "CONSUMED", consumedAt: params.approvedAt ?? new Date() },
  });

  return { reservation: updated, availableAfter, reservedAfter, amount, transaction };
}

/**
 * Releases the order's ACTIVE reservation (RESERVED -> AVAILABLE), writing
 * an ADVANCE_RELEASE ledger entry. MUST be called atomically alongside the
 * event that makes the order's remaining payment definitively fail (e.g.
 * PaymentsService.reject, or an order cancellation), inside the same
 * `prisma.$transaction`/locked account.
 *
 * Idempotent: returns `null` (no-op) if no ACTIVE reservation exists for
 * the order — a second rejection/cancellation attempt can never release
 * the same money twice.
 */
export async function releaseAdvanceReservation(tx: AdvanceReservationTxClient, params: SettleReservationParams) {
  const reservation = await tx.advanceReservation.findUnique({ where: { orderId: params.orderId } });
  if (!reservation || reservation.status !== "ACTIVE") {
    return null;
  }

  const amount = Number(reservation.amount);
  const { availableAfter, reservedAfter, transaction } = await appendLedgerEntry(tx, {
    accountId: reservation.advanceAccountId,
    type: "ADVANCE_RELEASE",
    amount,
    currentAvailable: params.currentAvailable,
    currentReserved: params.currentReserved,
    orderId: params.orderId,
    reference: params.reference ?? null,
    createdBy: params.createdBy,
  });

  const updated = await tx.advanceReservation.update({
    where: { orderId: params.orderId },
    data: { status: "RELEASED", releasedAt: new Date() },
  });

  return { reservation: updated, availableAfter, reservedAfter, amount, transaction };
}
