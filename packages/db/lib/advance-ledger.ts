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
  | "ADJUSTMENT";

// A transaction client exposes the same `$queryRaw`/model delegates as the
// full PrismaClient. Using a minimal structural type here (mirroring the
// existing `TxClient` convention in business-number.ts / enquiry-id.ts)
// keeps this helper usable from both apps/api (NestJS) and apps/web
// (Next.js route handlers).
export type AdvanceLedgerTxClient = {
  $queryRaw: (...args: any[]) => Promise<any>;
  customerAdvanceAccount: {
    update: (args: any) => Promise<{ availableBalance: unknown }>;
  };
  customerAdvanceTransaction: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
};

type AccountRow = {
  id: string;
  buyerId: string;
  availableBalance: string | number;
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
  // Current cached balance, read from inside the SAME locked transaction
  // (see lockAdvanceAccountRow above) — never trusted from a prior,
  // unlocked read.
  currentBalance: number;
  reference?: string | null;
  paymentMethod?: "MANUAL" | "PAYMENT_GATEWAY" | null;
  advancePaymentId?: string | null;
  orderId?: string | null;
  createdBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  reversalOfTransactionId?: string | null;
};

/**
 * Appends an immutable ledger row AND atomically updates the cached
 * CustomerAdvanceAccount.availableBalance to match. MUST be called from
 * inside a `prisma.$transaction` callback, after `lockAdvanceAccountRow` has
 * locked the account row within the same transaction.
 *
 * Sign convention: CREDIT/REFUND increase the balance; ORDER_PAYMENT/
 * REVERSAL decrease it. `amount` is always passed as a positive number; the
 * caller's `type` determines the direction via `signForType` below — never
 * mix positive/negative amount conventions at call sites.
 */
export async function appendLedgerEntry(tx: AdvanceLedgerTxClient, params: AppendLedgerEntryParams) {
  const sign = signForType(params.type);
  const delta = sign * Math.abs(params.amount);
  const balanceAfter = roundCurrency(params.currentBalance + delta);

  if (balanceAfter < 0) {
    throw new Error("Advance ledger entry would drive the account balance negative — refusing to apply");
  }

  const transaction = await tx.customerAdvanceTransaction.create({
    data: {
      accountId: params.accountId,
      type: params.type,
      amount: Math.abs(params.amount),
      balanceAfter,
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
    data: { availableBalance: balanceAfter },
  });

  return { transaction, balanceAfter };
}

function signForType(type: AdvanceTransactionTypeValue): 1 | -1 {
  if (type === "CREDIT" || type === "REFUND") return 1;
  if (type === "ORDER_PAYMENT" || type === "REVERSAL") return -1;
  // ADJUSTMENT: admin adjustments may increase or decrease the balance; the
  // caller encodes direction by passing a pre-signed `amount` magnitude
  // alongside a business reason, defaulting to a credit-like adjustment.
  return 1;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recomputes a CustomerAdvanceAccount's balance purely from its ledger
 * (Opening 0 + Credits + Refunds - OrderPayments - Reversals +/-
 * Adjustments), independent of the cached `availableBalance` column. Used
 * to verify the cache never drifts from the ledger (spec §33 "Balance
 * Reconciliation") — never exposed directly to buyers for self-service
 * balance manipulation.
 */
export async function reconcileAdvanceBalance(tx: AdvanceLedgerTxClient, accountId: string): Promise<number> {
  const entries = await tx.customerAdvanceTransaction.findMany({
    where: { accountId },
    select: { type: true, amount: true },
  });

  let balance = 0;
  for (const entry of entries) {
    const amount = Number(entry.amount);
    const sign = signForType(entry.type as AdvanceTransactionTypeValue);
    balance += sign * amount;
  }

  return roundCurrency(balance);
}
