// packages/db/lib/clear-transaction-data.js
//
// Pure decision logic + injectable-Prisma execution for
// scripts/clear-transaction-data.js. Mirrors the lib/db-safety.js split:
// this module never loads .env files, never reads process.argv, and never
// constructs a real PrismaClient — every function here takes its inputs as
// explicit parameters so it can be unit-tested with synthetic URLs and a
// mocked Prisma object with zero network/database I/O.
//
// Scope (see scripts/clear-transaction-data.js's own header comment for the
// full preserved-data rationale):
//   - DELETE_ORDER lists only pure transaction/activity tables.
//   - CustomerAdvanceAccount, User, SupplierProfile, Product,
//     CanonicalProduct, all pricing-history/config tables, and the
//     EnquirySequence/InvoiceSequence numbering counters are ALL preserved
//     — never deleted, reset, or otherwise written to by this module.
//   - BusinessSequence (the live EQ/OD/IN/AP/AR counter table) is preserved
//     BY DEFAULT — executeDeletion() only ever resets the specific row ids
//     a caller explicitly names via `resetSequenceIds`, restricted to an
//     allowlist of prefixes (RESETTABLE_SEQUENCE_PREFIXES: EQ_/OD_/IN_)
//     that deliberately EXCLUDES AP_/AR_ — those must never be reset while
//     a preserved AdvancePayment/AdvanceReceipt uses that same series (see
//     resolveAdvancePaymentPreservation). Omitting `resetSequenceIds`
//     entirely leaves every BusinessSequence row untouched, exactly as
//     before this capability was added.
//
// Atomicity: executeDeletion() has NO non-atomic execution path. It
// executes DELETE_ORDER only as a single prisma.$transaction([...]) call,
// and refuses (throws, zero deleteMany calls made) for any other decided
// strategy — including when decideTransactionStrategy() reports
// "sequential-best-effort" because row counts are missing/invalid or the
// data volume doesn't safely fit the configured transaction timeout. There
// is deliberately no code path that performs a non-atomic/sequential
// deletion against a real database.

"use strict";

const { parseConnectionString, isProductionDatabase, detectEnvironment } = require("./db-safety");

// Deletion order matters: children before parents, respecting every
// required (non-nullable) foreign key in prisma/schema.prisma. Every model
// here is pure transaction/activity data.
//
// Deliberately EXCLUDED (preserved, never deleted/reset by this module):
//   - customerAdvanceAccount        (the advance account itself — only its
//                                     child ledger/payment/reservation rows
//                                     below are cleared; the account row,
//                                     and its cached balance fields, are
//                                     left exactly as-is)
//   - enquirySequence, invoiceSequence, businessSequence
//                                    (numbering counters — preserved as-is,
//                                     never reset to zero)
//   - user, supplierProfile, product, canonicalProduct, and every
//     user-linked config / pricing-history table
const DELETE_ORDER = Object.freeze([
  "notificationDeliveryLog",
  "notificationPolicyAudit",
  "notificationEvent",
  "whatsAppMessageLog",
  "auditLog",
  "sourcingToolInvocation",
  "sourcingRecommendation",
  "orderItemSupplierCandidate",
  "supplierQuote",
  "purchaseOrderLineItem",
  "invoiceLineItem",
  "advanceReservation",
  // advanceReceipt is a CHILD of both customerAdvanceTransaction
  // (transactionId, required+unique) and advancePayment (advancePaymentId,
  // optional) — must be deleted before either parent to satisfy the FK
  // constraints in prisma/schema.prisma.
  "advanceReceipt",
  "customerAdvanceTransaction",
  "advancePayment",
  "paymentVerification",
  "orderTracking",
  "dispute",
  "supplierRating",
  "purchaseOrder",
  "invoice",
  "orderItem",
  "aggregationParticipant",
  "notification",
  "sourcingSession",
  "order",
  "aggregationPool",
  "cartItem",
  "watchlist",
  "quote",
  "quickRequest",
]);

// Documentation + test-assertion surface only — never read at runtime to
// drive any deletion/reset decision. Lists everything this module must
// NEVER touch (delete, update, or reset).
const PRESERVED_MODELS = Object.freeze([
  "user",
  "supplierProfile",
  "customerAdvanceAccount",
  "enquirySequence",
  "invoiceSequence",
  "businessSequence",
  "product",
  "canonicalProduct",
]);

// ---------------------------------------------------------------------------
// Safety-gate decision logic (fail-closed, pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Determines database identity/production status for the clear operation.
 * FAILS CLOSED: an absent or unparseable DATABASE_URL is treated as
 * "cannot verify safety" — never as "safe to proceed". Production
 * detection is identity-based (isProductionDatabase, keyed off the
 * hard-coded known Neon production endpoint in lib/db-safety.js), so a
 * database that is actually production is still caught even when
 * NODE_ENV/VERCEL_ENV claim "development".
 *
 * @param {object} env - process.env-shaped object (never mutated)
 */
function evaluateDatabaseIdentity(env) {
  const databaseUrl = env ? env.DATABASE_URL : undefined;
  const identity = parseConnectionString(databaseUrl);
  const environment = detectEnvironment(env);

  if (!identity) {
    // Cannot parse/verify identity at all -> fail closed: treated as
    // production-equivalent so every downstream caller refuses to
    // proceed, rather than silently treating "unknown" as "safe".
    return {
      parseable: false,
      environment,
      isProductionByIdentity: false,
      isProductionByLabel: environment === "production",
      isProduction: true,
    };
  }

  const isProductionByIdentity = isProductionDatabase(databaseUrl, env);
  const isProductionByLabel = environment === "production";

  return {
    parseable: true,
    environment,
    isProductionByIdentity,
    isProductionByLabel,
    // Endpoint-identity detection continues to apply even when the
    // environment label says "development" — a local NODE_ENV never
    // overrides what the connection string itself resolves to.
    isProduction: isProductionByIdentity || isProductionByLabel,
  };
}

/**
 * Single, explicit decision gate for whether the destructive deletion may
 * proceed. Composes:
 *   1. Database-identity verification (fail-closed — see
 *      evaluateDatabaseIdentity above). An absent/unparseable DATABASE_URL
 *      always blocks.
 *   2. The PRODUCTION approval gate — entirely separate from, and never
 *      satisfied merely by, the ordinary --yes/CONFIRM_RESET confirmation.
 *      Production requires BOTH ALLOW_PRODUCTION_DB_OPERATION=true AND
 *      CONFIRM_PRODUCTION_RESET=yes-i-am-sure, mirroring the existing
 *      double-gate pattern in lib/db-safety-preflight.js and
 *      scripts/reset-test-data.js.
 *   3. The ordinary explicit confirmation gate (--yes / CONFIRM_RESET=yes),
 *      required unconditionally, including after a production override —
 *      the production override never implies/skips it.
 *
 * @param {object} params
 * @param {object} params.env - process.env-shaped object
 * @param {boolean} params.confirmed - whether --yes or CONFIRM_RESET=yes was supplied
 */
function evaluateClearGate({ env, confirmed }) {
  const identity = evaluateDatabaseIdentity(env);
  const resolvedEnv = env || {};

  if (!identity.parseable) {
    return {
      allowed: false,
      identity,
      reason:
        "BLOCKED: DATABASE_URL is not set or is not a parseable postgres(ql):// " +
        "connection string. Refusing to proceed — database identity cannot be verified.",
    };
  }

  if (identity.isProduction) {
    const overrideFlag = resolvedEnv.ALLOW_PRODUCTION_DB_OPERATION === "true";
    const productionConfirmPhrase = resolvedEnv.CONFIRM_PRODUCTION_RESET === "yes-i-am-sure";

    if (!overrideFlag || !productionConfirmPhrase) {
      return {
        allowed: false,
        identity,
        reason:
          "BLOCKED: this script refuses to run against a database detected as production " +
          "(by Neon endpoint ID and/or environment label). This operation is destructive " +
          "and irreversible — it must never target production without an explicit, " +
          "double-gated override.\n\n" +
          "To proceed against production anyway, set BOTH of:\n" +
          "  ALLOW_PRODUCTION_DB_OPERATION=true\n" +
          "  CONFIRM_PRODUCTION_RESET=yes-i-am-sure\n\n" +
          "Supplying --yes or CONFIRM_RESET=yes alone is never sufficient for production.",
      };
    }

    // Production override satisfied — the ORDINARY confirmation gate below
    // still applies unconditionally; it is never skipped or implied by the
    // production override.
    if (!confirmed) {
      return {
        allowed: false,
        identity,
        reason:
          "Refusing to proceed without explicit confirmation (--yes or CONFIRM_RESET=yes), " +
          "even though the production override is active. The production override and the " +
          "ordinary confirmation gate are independent and BOTH are required.",
      };
    }

    return { allowed: true, identity, productionOverrideUsed: true };
  }

  if (!confirmed) {
    return {
      allowed: false,
      identity,
      reason: "Refusing to proceed without explicit confirmation (--yes or CONFIRM_RESET=yes).",
    };
  }

  return { allowed: true, identity, productionOverrideUsed: false };
}

// ---------------------------------------------------------------------------
// Transaction-strategy decision
// ---------------------------------------------------------------------------

// Prisma's interactive-transaction defaults are maxWait: 2000ms, timeout:
// 5000ms. This repo's existing precedent for a multi-step transaction with
// several sequential round-trips (apps/web/lib/order-checkout.ts,
// apps/api/src/aggregation/aggregation.service.ts, both doing a handful of
// point reads/writes) raises both to { maxWait: 10000, timeout: 15000 }.
// DELETE_ORDER has more steps than either precedent, and unlike them its
// per-step cost scales with the number of MATCHING rows (a deleteMany),
// not a fixed small number of point operations — so this module requires
// real row counts, captured immediately before the decision (see
// scripts/clear-transaction-data.js's countRowsToDelete), rather than
// assuming a fixed timeout is "obviously enough".
const SINGLE_TRANSACTION_MAX_WAIT_MS = 10000;
const SINGLE_TRANSACTION_TIMEOUT_MS = 15000;

// Conservative, documented estimate of deletion cost per matched row
// across all DELETE_ORDER tables combined (indexed FK deleteMany on a
// Neon/Postgres connection). This is deliberately pessimistic — real
// deletes are typically much faster — specifically so that the "does this
// fit in one transaction" decision below errs on the side of refusing
// atomicity rather than wrongly claiming it is safe.
const ESTIMATED_MS_PER_ROW = 2;

/**
 * Decides whether the full DELETE_ORDER set can safely run inside a single
 * Prisma interactive transaction (atomic: all rows deleted or none), or
 * whether that cannot be established as safe given the current row counts.
 *
 * This is a conservative, explicit decision — never a guess. When
 * `rowCounts` is not supplied, this function refuses to claim atomicity is
 * safe and reports the limitation instead, per the requirement to "stop
 * and report the limitation rather than claiming the operation is atomic."
 *
 * @param {Record<string, number>} [rowCounts] - per-model row counts for
 *   every model in DELETE_ORDER, captured immediately before the decision
 *   (e.g. via prisma[model].count()).
 */
function decideTransactionStrategy(rowCounts) {
  if (!rowCounts || typeof rowCounts !== "object") {
    return {
      strategy: "sequential-best-effort",
      atomic: false,
      totalRows: null,
      estimatedMs: null,
      reason:
        "Row counts for the DELETE_ORDER tables were not supplied, so the total data " +
        "volume (and therefore whether the full deletion set fits within the " +
        `${SINGLE_TRANSACTION_TIMEOUT_MS}ms interactive-transaction timeout) cannot be ` +
        "established. Refusing to claim the operation is atomic without that evidence. " +
        "This strategy is NEVER executed — see executeDeletion, which refuses to run " +
        "anything but a single atomic transaction.",
    };
  }

  // Require a finite, non-negative INTEGER count for every single model in
  // DELETE_ORDER. A missing key, a non-number, NaN/Infinity, a negative
  // number, or a non-integer (fractional) count are ALL treated as
  // "cannot establish safety" — never silently treated as zero. An
  // incomplete count set must refuse exactly like a totally absent one.
  const invalidModels = DELETE_ORDER.filter((model) => {
    const count = rowCounts[model];
    return (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 0
    );
  });

  if (invalidModels.length > 0) {
    return {
      strategy: "sequential-best-effort",
      atomic: false,
      totalRows: null,
      estimatedMs: null,
      reason:
        "Row counts are missing or invalid for: " +
        invalidModels.join(", ") +
        ". Every model in DELETE_ORDER requires a finite, non-negative integer count " +
        "before a transaction strategy can be decided — an incomplete or invalid count " +
        "set is refused, never treated as zero. This strategy is NEVER executed — see " +
        "executeDeletion, which refuses to run anything but a single atomic transaction.",
    };
  }

  const totalRows = DELETE_ORDER.reduce((sum, model) => sum + rowCounts[model], 0);

  const estimatedMs = totalRows * ESTIMATED_MS_PER_ROW;
  // Require real headroom under the configured timeout — an estimate
  // landing right at the limit is not "safely fits".
  const safeThresholdMs = SINGLE_TRANSACTION_TIMEOUT_MS * 0.5;

  if (estimatedMs <= safeThresholdMs) {
    return {
      strategy: "single-transaction",
      atomic: true,
      totalRows,
      estimatedMs,
      reason:
        `Estimated deletion time (${estimatedMs}ms for ${totalRows} total rows, at a ` +
        `conservative ${ESTIMATED_MS_PER_ROW}ms/row) fits comfortably within the ` +
        `${SINGLE_TRANSACTION_TIMEOUT_MS}ms interactive-transaction timeout (maxWait: ` +
        `${SINGLE_TRANSACTION_MAX_WAIT_MS}ms). The full DELETE_ORDER set will run inside one ` +
        "prisma.$transaction(...) call, so a failure partway through rolls back every " +
        "change made in this run.",
    };
  }

  return {
    strategy: "sequential-best-effort",
    atomic: false,
    totalRows,
    estimatedMs,
    reason:
      `Estimated deletion time (${estimatedMs}ms for ${totalRows} total rows, at a ` +
      `conservative ${ESTIMATED_MS_PER_ROW}ms/row) does not safely fit within the ` +
      `${SINGLE_TRANSACTION_TIMEOUT_MS}ms interactive-transaction timeout with an adequate ` +
      "safety margin. Refusing to claim the operation is atomic. This strategy is NEVER " +
      "executed — see executeDeletion, which refuses to run anything but a single atomic " +
      "transaction. Consider clearing in smaller batches or during a maintenance window " +
      "if this recurs; re-run this decision after reducing the data volume.",
  };
}

// ---------------------------------------------------------------------------
// Execution (injectable prisma — testable with mocked delegates)
// ---------------------------------------------------------------------------

/**
 * Models that may carry a one-off "preserve" exclusion — i.e. a single
 * AdvancePayment the caller wants kept, plus its directly-linked
 * CustomerAdvanceTransaction (the CREDIT ledger row) and AdvanceReceipt
 * (the receipt issued for that ledger row). No other model in DELETE_ORDER
 * supports exclusion — every other table is always cleared unconditionally.
 */
const PRESERVABLE_MODELS = Object.freeze(["advancePayment", "customerAdvanceTransaction", "advanceReceipt"]);

/**
 * Resolves the exact row ids to EXCLUDE from deletion for a single named
 * AdvancePayment (identified by its human-readable, unique
 * `referenceNumber`, e.g. "AP/2607/00001") plus its directly-linked
 * CustomerAdvanceTransaction and AdvanceReceipt row(s).
 *
 * FAILS CLOSED: if no AdvancePayment with that referenceNumber exists, this
 * throws immediately rather than silently resolving to "nothing to
 * preserve" (which would make the caller delete the row believing it was
 * excluded). This is read-only — it never deletes/modifies anything.
 *
 * @param {object} prisma - a Prisma-client-shaped object exposing
 *   `prisma.advancePayment.findUnique` and `prisma.advanceReceipt.findMany`.
 * @param {string} referenceNumber - the AdvancePayment.referenceNumber to
 *   preserve (e.g. "AP/2607/00001").
 * @returns {Promise<{ advancePaymentId: string, customerAdvanceTransactionId: string|null, advanceReceiptIds: string[] }>}
 */
async function resolveAdvancePaymentPreservation(prisma, referenceNumber) {
  if (!referenceNumber || typeof referenceNumber !== "string") {
    throw new Error(
      "resolveAdvancePaymentPreservation: referenceNumber must be a non-empty string — refusing to " +
        "resolve an exclusion for an unspecified AdvancePayment."
    );
  }

  const payment = await prisma.advancePayment.findUnique({
    where: { referenceNumber },
    select: { id: true, creditTransaction: { select: { id: true } } },
  });

  if (!payment) {
    throw new Error(
      `resolveAdvancePaymentPreservation: no AdvancePayment found with referenceNumber "${referenceNumber}". ` +
        "Refusing to proceed — an unresolvable preservation target must never be silently treated as " +
        "\"nothing to preserve\" (that would delete the row the caller intended to keep)."
    );
  }

  const customerAdvanceTransactionId = payment.creditTransaction ? payment.creditTransaction.id : null;

  // AdvanceReceipt links to the AdvancePayment both directly
  // (advancePaymentId, optional) and indirectly via the CREDIT transaction
  // (transactionId, required+unique) — collect both so a receipt is never
  // missed regardless of which FK it was recorded against.
  const receiptWhere = customerAdvanceTransactionId
    ? { OR: [{ advancePaymentId: payment.id }, { transactionId: customerAdvanceTransactionId }] }
    : { advancePaymentId: payment.id };
  const receipts = await prisma.advanceReceipt.findMany({ where: receiptWhere, select: { id: true } });

  return {
    advancePaymentId: payment.id,
    customerAdvanceTransactionId,
    advanceReceiptIds: receipts.map((r) => r.id),
  };
}

/**
 * Counts rows for every model in DELETE_ORDER via the injected prisma
 * client. Read-only — never deletes/modifies anything. Used both to
 * report pre-deletion counts and to feed decideTransactionStrategy().
 *
 * @param {object} prisma - a Prisma-client-shaped object; only
 *   `prisma[model].count()` is called.
 * @param {{ advancePaymentId?: string, customerAdvanceTransactionId?: string|null, advanceReceiptIds?: string[] }} [preserve]
 *   - optional exclusion ids from resolveAdvancePaymentPreservation(); when
 *     provided, the count for the matching PRESERVABLE_MODELS excludes
 *     those specific ids (mirrors what executeDeletion will actually
 *     delete), so the reported count is never misleading.
 */
async function countRowsToDelete(prisma, preserve) {
  const counts = {};
  for (const model of DELETE_ORDER) {
    const where = buildDeleteWhere(model, preserve);
    counts[model] = await prisma[model].count({ where });
  }
  return counts;
}

/**
 * Builds the `where` clause passed to deleteMany/count for a given model,
 * applying the one-off preserve exclusion (if any) only to the three
 * PRESERVABLE_MODELS. Every other model always gets `{}` (unconditional —
 * unchanged behaviour). Returns `{}` whenever there is nothing to exclude
 * for that model, so existing callers without a `preserve` argument behave
 * exactly as before.
 */
function buildDeleteWhere(model, preserve) {
  if (!preserve) return {};

  if (model === "advancePayment" && preserve.advancePaymentId) {
    return { id: { not: preserve.advancePaymentId } };
  }
  if (model === "customerAdvanceTransaction" && preserve.customerAdvanceTransactionId) {
    return { id: { not: preserve.customerAdvanceTransactionId } };
  }
  if (model === "advanceReceipt" && preserve.advanceReceiptIds && preserve.advanceReceiptIds.length > 0) {
    return { id: { notIn: preserve.advanceReceiptIds } };
  }
  return {};
}

/**
 * Numbering-counter (BusinessSequence) keys this module is willing to
 * reset — deliberately an explicit ALLOWLIST, never "reset every
 * BusinessSequence row found". A caller must name each key it wants reset
 * (e.g. "EQ_26", "OD_26"); any key not listed here (notably AP_<fy>/AR_<fy>,
 * which must never be reset while an AdvancePayment/AdvanceReceipt using
 * that series is being preserved — see resolveAdvancePaymentPreservation)
 * is simply never touched by executeDeletion()'s sequence-reset below,
 * regardless of what the caller passes.
 */
const RESETTABLE_SEQUENCE_PREFIXES = Object.freeze(["EQ_", "OD_", "IN_"]);

/**
 * Validates a list of BusinessSequence row ids the caller wants reset to
 * value 0, rejecting (throwing) anything that isn't a plain "<PREFIX>_<fy>"
 * key with an allowlisted prefix. Pure validation — performs no database
 * I/O and never silently drops/ignores an invalid entry (fails closed, the
 * same convention as resolveAdvancePaymentPreservation above).
 *
 * @param {string[]} sequenceIds - e.g. ["EQ_26", "OD_26"]
 * @returns {string[]} the same list, once validated
 */
function validateResettableSequenceIds(sequenceIds) {
  if (!Array.isArray(sequenceIds) || sequenceIds.length === 0) {
    throw new Error("validateResettableSequenceIds: sequenceIds must be a non-empty array of BusinessSequence ids.");
  }
  for (const id of sequenceIds) {
    const allowed = RESETTABLE_SEQUENCE_PREFIXES.some((prefix) => typeof id === "string" && id.startsWith(prefix));
    if (!allowed) {
      throw new Error(
        `validateResettableSequenceIds: "${id}" is not an allowlisted resettable BusinessSequence id ` +
          `(allowed prefixes: ${RESETTABLE_SEQUENCE_PREFIXES.join(", ")}). Refusing to reset — in particular, ` +
          "AP_<fy>/AR_<fy> rows must never be reset by this function."
      );
    }
  }
  return sequenceIds;
}

/**
 * Executes the deletion — but ONLY the atomic "single-transaction"
 * strategy. There is no executable non-atomic fallback: if `decision`
 * is anything other than `{ strategy: "single-transaction", atomic: true }`,
 * this function throws immediately and calls ZERO `deleteMany` operations.
 * Never deletes/resets anything outside DELETE_ORDER plus the optional,
 * explicitly-allowlisted BusinessSequence reset below (CustomerAdvanceAccount
 * and every sequence id NOT passed in `resetSequenceIds` are never touched).
 *
 * Every deleteMany in DELETE_ORDER (child-first order, respecting the FK
 * relationships in prisma/schema.prisma) runs inside ONE
 * prisma.$transaction([...]) call. If any step throws, Prisma rolls back
 * every change made by the whole array — the real guarantee this relies
 * on is Prisma's own transactional semantics for the array form of
 * `$transaction`, not anything this module invents. If the transaction
 * throws, the error propagates to the caller unchanged; this function
 * never retries and never falls back to per-model deleteMany calls.
 *
 * @param {object} prisma - a Prisma-client-shaped object exposing
 *   `prisma[model].deleteMany({ where })` for every model in DELETE_ORDER,
 *   and `prisma.$transaction(arrayOfPromises, options)`.
 * @param {{ strategy: string, atomic: boolean }} decision - must be exactly
 *   decideTransactionStrategy()'s single-transaction result; any other
 *   strategy (including a totally absent/invalid decision object) refuses.
 * @param {{ advancePaymentId?: string, customerAdvanceTransactionId?: string|null, advanceReceiptIds?: string[] }} [preserve]
 *   - optional one-off exclusion from resolveAdvancePaymentPreservation().
 *     When provided, deleteMany for advancePayment/customerAdvanceTransaction/
 *     advanceReceipt excludes exactly those ids; every other model in
 *     DELETE_ORDER is always deleted unconditionally (`deleteMany({})`),
 *     exactly as before. Omitting this argument preserves prior behaviour
 *     in full (every model unconditional).
 * @param {string[]} [resetSequenceIds] - optional explicit allowlist of
 *   BusinessSequence row ids (e.g. ["EQ_26", "OD_26"]) to reset to
 *   value: 0, in the SAME atomic transaction as the deletion. Validated via
 *   validateResettableSequenceIds() before any database call is made.
 *   Omitting this argument preserves prior behaviour in full (no
 *   BusinessSequence row is ever touched).
 * @returns {Promise<Record<string, number>>} per-model deleted row counts
 *   (plus `businessSequenceReset` — the number of BusinessSequence rows
 *   reset — when `resetSequenceIds` was provided).
 */
async function executeDeletion(prisma, decision, preserve, resetSequenceIds) {
  if (!decision || decision.strategy !== "single-transaction" || decision.atomic !== true) {
    throw new Error(
      "Refusing to execute: the deletion can only proceed as a single atomic " +
        "prisma.$transaction([...]) covering every DELETE_ORDER model. The decided " +
        `strategy was "${decision && decision.strategy}" (atomic: ${decision && decision.atomic}), ` +
        "which does not meet that bar. There is no non-atomic execution path — zero " +
        "deleteMany calls have been made. See decision.reason for why atomicity could " +
        "not be established, and re-run decideTransactionStrategy() with valid row counts."
    );
  }

  const validatedSequenceIds = resetSequenceIds ? validateResettableSequenceIds(resetSequenceIds) : null;

  const deleteOps = DELETE_ORDER.map((model) => prisma[model].deleteMany({ where: buildDeleteWhere(model, preserve) }));
  const sequenceOp = validatedSequenceIds
    ? [prisma.businessSequence.updateMany({ where: { id: { in: validatedSequenceIds } }, data: { value: 0 } })]
    : [];

  const results = await prisma.$transaction([...deleteOps, ...sequenceOp], {
    maxWait: SINGLE_TRANSACTION_MAX_WAIT_MS,
    timeout: SINGLE_TRANSACTION_TIMEOUT_MS,
  });

  const counts = {};
  DELETE_ORDER.forEach((model, index) => {
    counts[model] = results[index].count;
  });
  if (validatedSequenceIds) {
    counts.businessSequenceReset = results[DELETE_ORDER.length].count;
  }
  return counts;
}

module.exports = {
  DELETE_ORDER,
  PRESERVED_MODELS,
  PRESERVABLE_MODELS,
  RESETTABLE_SEQUENCE_PREFIXES,
  evaluateDatabaseIdentity,
  evaluateClearGate,
  decideTransactionStrategy,
  resolveAdvancePaymentPreservation,
  validateResettableSequenceIds,
  buildDeleteWhere,
  countRowsToDelete,
  executeDeletion,
  SINGLE_TRANSACTION_MAX_WAIT_MS,
  SINGLE_TRANSACTION_TIMEOUT_MS,
  ESTIMATED_MS_PER_ROW,
};
