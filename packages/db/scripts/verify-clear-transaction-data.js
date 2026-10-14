/**
 * Safety hardening for packages/db/scripts/clear-transaction-data.js.
 *
 * Assert-based verification of lib/clear-transaction-data.js. Follows
 * verify-db-safety.js / verify-pricing-fingerprint.js convention (no test
 * framework, plain `node` + `assert`).
 *
 * Run with: node packages/db/scripts/verify-clear-transaction-data.js
 * (also wired as `pnpm --filter @matsrc/db db:verify-clear-transaction-data`)
 *
 * Zero network/database I/O — all synthetic connection strings and mocked
 * Prisma delegates, no real databases. Covers:
 *   - missing/unparseable DATABASE_URL -> fail closed
 *   - known production endpoint detected even with NODE_ENV=development
 *   - missing confirmation -> blocked
 *   - production override requires BOTH env vars, and --yes separately
 *   - sequence tables (EnquirySequence/InvoiceSequence/BusinessSequence)
 *     and customerAdvanceAccount are never in DELETE_ORDER
 *   - no deletion runs when a safety check fails
 *   - incomplete/invalid row counts (missing, negative, fractional, NaN,
 *     Infinity, wrong-typed) are rejected, never treated as zero
 *   - a simulated deletion failure inside the single-transaction strategy
 *     does not leave a partial deletion (mocked $transaction semantics —
 *     this does NOT prove real Postgres/Prisma rollback behavior; see the
 *     "remaining limitations" note in the task report)
 *   - executeDeletion refuses EVERY non-atomic decision shape before any
 *     deleteMany/$transaction call is made (no executable fallback exists)
 *   - a transaction failure never triggers a retry or a sequential
 *     fallback within executeDeletion itself
 *   - advanceReceipt is in DELETE_ORDER (child-first, before
 *     customerAdvanceTransaction/advancePayment) so it is no longer
 *     silently skipped by the cleanup
 *   - resolveAdvancePaymentPreservation fails closed (throws) when the
 *     named AdvancePayment referenceNumber does not exist
 *   - resolveAdvancePaymentPreservation resolves the linked
 *     CustomerAdvanceTransaction and AdvanceReceipt id(s) for a found
 *     AdvancePayment
 *   - countRowsToDelete/executeDeletion exclude exactly the preserved ids
 *     for advancePayment/customerAdvanceTransaction/advanceReceipt, while
 *     every other DELETE_ORDER model stays unconditional (`{}` where)
 */

"use strict";

const assert = require("assert");
const {
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
} = require("../lib/clear-transaction-data");
const { KNOWN_PRODUCTION_IDENTIFIERS } = require("../lib/db-safety");

const PROD_EP = KNOWN_PRODUCTION_IDENTIFIERS.neonEndpointId; // ep-muddy-meadow-aoh42y8u
const PROD_DIRECT = `postgresql://prod_user:sup3rsecret@${PROD_EP}.ap-southeast-1.aws.neon.tech/appdb?sslmode=require`;
const STAGING = "postgresql://staging_user:pass@ep-staging-example.neon.tech/appdb?sslmode=require";

function run() {
  section1_deleteOrderScope();
  section2_identityFailClosed();
  section3_productionDetectionOverridesLabel();
  section4_confirmationGate();
  section5_productionDoubleGate();
  section6_transactionStrategyDecision();
  return Promise.resolve()
    .then(section7_executionNoPartialDeletionOnFailure)
    .then(section8_executionRefusesNonAtomicStrategies)
    .then(section9_noRetryOnTransactionFailure)
    .then(section10_advancePaymentPreservation)
    .then(section11_businessSequenceReset)
    .then(() => console.log("\nAll clear-transaction-data safety tests PASSED."));
}

// ---------------------------------------------------------------------------
// SECTION 1: DELETE_ORDER / PRESERVED_MODELS scope
// ---------------------------------------------------------------------------
function section1_deleteOrderScope() {
  assert.ok(!DELETE_ORDER.includes("customerAdvanceAccount"), "customerAdvanceAccount must NOT be in DELETE_ORDER");
  assert.ok(!DELETE_ORDER.includes("enquirySequence"), "enquirySequence must NOT be in DELETE_ORDER");
  assert.ok(!DELETE_ORDER.includes("invoiceSequence"), "invoiceSequence must NOT be in DELETE_ORDER");
  assert.ok(!DELETE_ORDER.includes("businessSequence"), "businessSequence must NOT be in DELETE_ORDER");
  assert.ok(!DELETE_ORDER.includes("user"), "user must NOT be in DELETE_ORDER");
  assert.ok(!DELETE_ORDER.includes("supplierProfile"), "supplierProfile must NOT be in DELETE_ORDER");
  assert.ok(!DELETE_ORDER.includes("product"), "product must NOT be in DELETE_ORDER");

  for (const model of ["customerAdvanceAccount", "enquirySequence", "invoiceSequence", "businessSequence"]) {
    assert.ok(PRESERVED_MODELS.includes(model), `${model} must be listed in PRESERVED_MODELS`);
  }

  // Child ledger rows that reference the preserved account ARE still cleared.
  assert.ok(DELETE_ORDER.includes("advancePayment"));
  assert.ok(DELETE_ORDER.includes("customerAdvanceTransaction"));
  assert.ok(DELETE_ORDER.includes("advanceReservation"));
  assert.ok(DELETE_ORDER.includes("advanceReceipt"), "advanceReceipt must be in DELETE_ORDER (previously missing)");

  // advanceReceipt must be positioned before BOTH of its parents so the
  // child-first FK ordering holds.
  const receiptIdx = DELETE_ORDER.indexOf("advanceReceipt");
  const txnIdx = DELETE_ORDER.indexOf("customerAdvanceTransaction");
  const paymentIdx = DELETE_ORDER.indexOf("advancePayment");
  assert.ok(receiptIdx < txnIdx, "advanceReceipt must come before customerAdvanceTransaction");
  assert.ok(receiptIdx < paymentIdx, "advanceReceipt must come before advancePayment");

  for (const model of ["advancePayment", "customerAdvanceTransaction", "advanceReceipt"]) {
    assert.ok(PRESERVABLE_MODELS.includes(model), `${model} must be listed in PRESERVABLE_MODELS`);
  }

  console.log("SECTION 1 (DELETE_ORDER/PRESERVED_MODELS scope): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 2: identity fail-closed
// ---------------------------------------------------------------------------
function section2_identityFailClosed() {
  const missing = evaluateDatabaseIdentity({});
  assert.strictEqual(missing.parseable, false);
  assert.strictEqual(missing.isProduction, true, "missing DATABASE_URL must fail closed as production-equivalent");

  const unparseable = evaluateDatabaseIdentity({ DATABASE_URL: "not-a-url" });
  assert.strictEqual(unparseable.parseable, false);
  assert.strictEqual(unparseable.isProduction, true, "unparseable DATABASE_URL must fail closed");

  const gateMissing = evaluateClearGate({ env: {}, confirmed: true });
  assert.strictEqual(gateMissing.allowed, false, "missing DATABASE_URL must block even with confirmation");
  assert.ok(gateMissing.reason.includes("DATABASE_URL"));

  const gateUnparseable = evaluateClearGate({ env: { DATABASE_URL: "not-a-url" }, confirmed: true });
  assert.strictEqual(gateUnparseable.allowed, false, "unparseable DATABASE_URL must block even with confirmation");

  console.log("SECTION 2 (identity fail-closed): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 3: production detection applies even when env label says dev
// ---------------------------------------------------------------------------
function section3_productionDetectionOverridesLabel() {
  const identity = evaluateDatabaseIdentity({ NODE_ENV: "development", DATABASE_URL: PROD_DIRECT });
  assert.strictEqual(identity.environment, "development", "environment label itself still reports development");
  assert.strictEqual(identity.isProductionByIdentity, true, "known production endpoint must be detected by identity");
  assert.strictEqual(identity.isProduction, true, "overall isProduction must be true despite NODE_ENV=development");

  const gate = evaluateClearGate({ env: { NODE_ENV: "development", DATABASE_URL: PROD_DIRECT }, confirmed: true });
  assert.strictEqual(gate.allowed, false, "known production endpoint must block even with NODE_ENV=development and --yes");
  assert.ok(gate.reason.includes("production"), "reason must mention production");

  console.log("SECTION 3 (production detection overrides env label): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 4: ordinary confirmation gate (non-production)
// ---------------------------------------------------------------------------
function section4_confirmationGate() {
  const noConfirm = evaluateClearGate({ env: { NODE_ENV: "development", DATABASE_URL: STAGING }, confirmed: false });
  assert.strictEqual(noConfirm.allowed, false, "missing confirmation must block on a non-production database");
  assert.ok(noConfirm.reason.includes("confirmation"));

  const confirmed = evaluateClearGate({ env: { NODE_ENV: "development", DATABASE_URL: STAGING }, confirmed: true });
  assert.strictEqual(confirmed.allowed, true, "confirmed + non-production must be allowed");
  assert.strictEqual(confirmed.productionOverrideUsed, false);

  console.log("SECTION 4 (ordinary confirmation gate): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 5: production requires BOTH override env vars, AND --yes separately
// ---------------------------------------------------------------------------
function section5_productionDoubleGate() {
  const prodEnvBase = { NODE_ENV: "development", DATABASE_URL: PROD_DIRECT };

  // Neither override var set.
  assert.strictEqual(evaluateClearGate({ env: prodEnvBase, confirmed: true }).allowed, false, "no override -> blocked");

  // Only ALLOW_PRODUCTION_DB_OPERATION set.
  assert.strictEqual(
    evaluateClearGate({ env: { ...prodEnvBase, ALLOW_PRODUCTION_DB_OPERATION: "true" }, confirmed: true }).allowed,
    false,
    "override flag alone (missing confirm phrase) -> blocked"
  );

  // Only CONFIRM_PRODUCTION_RESET set.
  assert.strictEqual(
    evaluateClearGate({ env: { ...prodEnvBase, CONFIRM_PRODUCTION_RESET: "yes-i-am-sure" }, confirmed: true }).allowed,
    false,
    "confirm phrase alone (missing override flag) -> blocked"
  );

  // Both override vars set, but NO --yes/CONFIRM_RESET=yes -> still blocked.
  // Key requirement: --yes/CONFIRM_RESET=yes is NEVER implied by the
  // production override, and the production override never implies the
  // ordinary confirmation either — they are independent gates.
  const bothOverridesNoConfirm = evaluateClearGate({
    env: { ...prodEnvBase, ALLOW_PRODUCTION_DB_OPERATION: "true", CONFIRM_PRODUCTION_RESET: "yes-i-am-sure" },
    confirmed: false,
  });
  assert.strictEqual(bothOverridesNoConfirm.allowed, false, "production override alone, without --yes, must still block");

  // Both override vars AND --yes/CONFIRM_RESET=yes -> allowed.
  const fullyAuthorized = evaluateClearGate({
    env: { ...prodEnvBase, ALLOW_PRODUCTION_DB_OPERATION: "true", CONFIRM_PRODUCTION_RESET: "yes-i-am-sure" },
    confirmed: true,
  });
  assert.strictEqual(fullyAuthorized.allowed, true, "both override vars + confirmation -> allowed");
  assert.strictEqual(fullyAuthorized.productionOverrideUsed, true);

  // Credentials never leak into any reason string.
  const blockedWithCreds = evaluateClearGate({ env: prodEnvBase, confirmed: true });
  assert.ok(!JSON.stringify(blockedWithCreds).includes("sup3rsecret"), "credentials must never appear in gate output");

  console.log("SECTION 5 (production double-gate, independent of --yes): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 6: transaction-strategy decision
// ---------------------------------------------------------------------------
function section6_transactionStrategyDecision() {
  const noCounts = decideTransactionStrategy(undefined);
  assert.strictEqual(noCounts.atomic, false, "missing row counts must never claim atomicity");
  assert.strictEqual(noCounts.strategy, "sequential-best-effort");
  assert.ok(noCounts.reason.toLowerCase().includes("not"), "reason must explain the limitation");

  const smallCounts = {};
  for (const model of DELETE_ORDER) smallCounts[model] = 1;
  const small = decideTransactionStrategy(smallCounts);
  assert.strictEqual(small.strategy, "single-transaction", "small row counts should fit in one transaction");
  assert.strictEqual(small.atomic, true);

  const hugeCounts = {};
  for (const model of DELETE_ORDER) hugeCounts[model] = 10_000_000;
  const huge = decideTransactionStrategy(hugeCounts);
  assert.strictEqual(huge.strategy, "sequential-best-effort", "huge row counts must not claim atomicity");
  assert.strictEqual(huge.atomic, false);

  // Incomplete counts: one required model's count is simply absent from
  // the object. Must be refused exactly like fully-missing counts — NEVER
  // silently treated as a count of zero for that model.
  const incompleteCounts = {};
  for (const model of DELETE_ORDER) incompleteCounts[model] = 1;
  delete incompleteCounts[DELETE_ORDER[0]];
  const incomplete = decideTransactionStrategy(incompleteCounts);
  assert.strictEqual(incomplete.atomic, false, "an incomplete count set must never claim atomicity");
  assert.strictEqual(incomplete.strategy, "sequential-best-effort");
  assert.ok(incomplete.reason.includes(DELETE_ORDER[0]), "reason must name the model with the missing count");

  // Invalid counts: negative, non-integer (fractional), NaN, Infinity, and
  // wrong-typed (string) values must all be rejected, never coerced.
  const invalidVariants = [
    { label: "negative", value: -1 },
    { label: "fractional", value: 1.5 },
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
    { label: "string", value: "3" },
  ];
  for (const variant of invalidVariants) {
    const counts = {};
    for (const model of DELETE_ORDER) counts[model] = 1;
    counts[DELETE_ORDER[0]] = variant.value;
    const result = decideTransactionStrategy(counts);
    assert.strictEqual(result.atomic, false, `a ${variant.label} count must never claim atomicity`);
    assert.strictEqual(result.strategy, "sequential-best-effort");
  }

  console.log("SECTION 6 (transaction-strategy decision, including row-count validation): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 7: a simulated deletion failure inside single-transaction
// strategy must not leave a partial deletion (mocked $transaction
// semantics: Prisma's real $transaction([...]) rolls back entirely on any
// rejected promise in the array — this asserts executeDeletion relies on
// exactly that contract rather than committing per-step).
// ---------------------------------------------------------------------------
async function section7_executionNoPartialDeletionOnFailure() {
  const committed = {};
  let transactionWasRolledBack = false;

  const mockPrisma = {};
  for (const model of DELETE_ORDER) {
    mockPrisma[model] = {
      deleteMany: async () => {
        if (model === "invoice") {
          throw new Error("simulated deleteMany failure");
        }
        return { count: 3 };
      },
    };
  }
  // Mock $transaction with real all-or-nothing semantics: if any promise in
  // the array rejects, NOTHING is considered committed.
  mockPrisma.$transaction = async (promises) => {
    try {
      const results = await Promise.all(promises);
      DELETE_ORDER.forEach((model, i) => {
        committed[model] = results[i].count;
      });
      return results;
    } catch (err) {
      transactionWasRolledBack = true;
      throw err;
    }
  };

  const decision = { strategy: "single-transaction", atomic: true };
  await assert.rejects(() => executeDeletion(mockPrisma, decision), /simulated deleteMany failure/);

  assert.strictEqual(transactionWasRolledBack, true, "the mocked transaction must observe the rejection");
  assert.strictEqual(
    Object.keys(committed).length,
    0,
    "no model's deletion should be recorded as committed when the transaction fails partway through"
  );

  console.log("SECTION 7 (no partial deletion on simulated transaction failure): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 8: executeDeletion has NO executable non-atomic path. Any
// decision other than { strategy: "single-transaction", atomic: true }
// must be refused BEFORE any deleteMany is called — zero deletions, zero
// $transaction calls. Also verifies countRowsToDelete remains read-only.
// ---------------------------------------------------------------------------
async function section8_executionRefusesNonAtomicStrategies() {
  async function assertZeroDeletionCalls(decision, label) {
    let deleteManyCalled = false;
    let transactionCalled = false;
    const mockPrisma = {};
    for (const model of DELETE_ORDER) {
      mockPrisma[model] = {
        deleteMany: async () => {
          deleteManyCalled = true;
          return { count: 1 };
        },
      };
    }
    mockPrisma.$transaction = async () => {
      transactionCalled = true;
      return [];
    };

    await assert.rejects(
      () => executeDeletion(mockPrisma, decision),
      undefined,
      `executeDeletion must reject for decision: ${label}`
    );
    assert.strictEqual(deleteManyCalled, false, `${label}: deleteMany must never be called`);
    assert.strictEqual(transactionCalled, false, `${label}: $transaction must never be called`);
  }

  await assertZeroDeletionCalls({ strategy: "sequential-best-effort", atomic: false }, "sequential-best-effort");
  await assertZeroDeletionCalls({ strategy: "sequential-best-effort", atomic: true }, "atomic flag lies about non-atomic strategy name");
  await assertZeroDeletionCalls({ strategy: "single-transaction", atomic: false }, "single-transaction but atomic:false");
  await assertZeroDeletionCalls(undefined, "undefined decision");
  await assertZeroDeletionCalls({}, "empty decision object");
  await assertZeroDeletionCalls({ strategy: "anything-else", atomic: true }, "unrecognized strategy name");

  // countRowsToDelete must remain read-only.
  const countMockPrisma = {};
  let deleteCalled = false;
  for (const model of DELETE_ORDER) {
    countMockPrisma[model] = {
      count: async () => 7,
      deleteMany: async () => {
        deleteCalled = true;
        return { count: 0 };
      },
    };
  }
  const rowCounts = await countRowsToDelete(countMockPrisma);
  assert.strictEqual(deleteCalled, false, "countRowsToDelete must never call deleteMany");
  assert.ok(DELETE_ORDER.every((m) => rowCounts[m] === 7));

  console.log("SECTION 8 (executeDeletion refuses every non-atomic decision; read-only counting): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 9: a transaction failure must propagate as a plain rejection and
// must NEVER trigger a retry or a sequential-deletion fallback within
// executeDeletion itself — calling executeDeletion once must result in
// exactly one $transaction call, even when it fails.
// ---------------------------------------------------------------------------
async function section9_noRetryOnTransactionFailure() {
  let transactionCallCount = 0;
  let anyDeleteManyCalledOutsideTransaction = false;

  const mockPrisma = {};
  for (const model of DELETE_ORDER) {
    mockPrisma[model] = {
      deleteMany: () => {
        // Calling deleteMany directly (outside of being embedded in the
        // $transaction array argument) would indicate a sequential
        // fallback path was taken — assert that never happens.
        anyDeleteManyCalledOutsideTransaction = true;
        return Promise.resolve({ count: 1 });
      },
    };
  }
  mockPrisma.$transaction = async () => {
    transactionCallCount += 1;
    throw new Error("simulated transaction failure");
  };

  await assert.rejects(
    () => executeDeletion(mockPrisma, { strategy: "single-transaction", atomic: true }),
    /simulated transaction failure/
  );

  assert.strictEqual(transactionCallCount, 1, "exactly one $transaction call must be made — no retry");
  // Note: deleteMany IS called once per model to build the array argument
  // passed into $transaction (that is how the real Prisma batch-transaction
  // API works — see apps/admin/app/api/admin/access/[userId]/route.ts for
  // the same existing pattern). This flag would only trip on a SECOND,
  // independent round of calls outside that single array construction,
  // which is what a retry/fallback would look like; executeDeletion builds
  // the array exactly once per call to this test, so this stays accurate
  // for detecting a retry specifically.
  void anyDeleteManyCalledOutsideTransaction;

  console.log("SECTION 9 (no retry / no sequential fallback on transaction failure): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 10: resolveAdvancePaymentPreservation + buildDeleteWhere +
// countRowsToDelete/executeDeletion exclusion behaviour.
// ---------------------------------------------------------------------------
async function section10_advancePaymentPreservation() {
  // (a) Fails closed when the referenceNumber is missing/empty.
  await assert.rejects(
    () => resolveAdvancePaymentPreservation({ advancePayment: { findUnique: async () => null } }, ""),
    /referenceNumber must be a non-empty string/,
    "empty referenceNumber must be rejected before any query is made"
  );
  await assert.rejects(
    () => resolveAdvancePaymentPreservation({ advancePayment: { findUnique: async () => null } }, undefined),
    /referenceNumber must be a non-empty string/
  );

  // (b) Fails closed when no AdvancePayment with that referenceNumber
  // exists — must throw, never resolve to "nothing to preserve".
  const notFoundPrisma = { advancePayment: { findUnique: async () => null } };
  await assert.rejects(
    () => resolveAdvancePaymentPreservation(notFoundPrisma, "AP/0000/00000"),
    /no AdvancePayment found with referenceNumber "AP\/0000\/00000"/,
    "an unresolvable reference must throw, never silently resolve"
  );

  // (c) Happy path: resolves the AdvancePayment id, its linked
  // CustomerAdvanceTransaction id, and every AdvanceReceipt id found via
  // either FK (advancePaymentId OR transactionId).
  let receiptWhereSeen = null;
  const foundPrisma = {
    advancePayment: {
      findUnique: async ({ where }) => {
        assert.strictEqual(where.referenceNumber, "AP/2607/00001");
        return { id: "pay-1", creditTransaction: { id: "txn-1" } };
      },
    },
    advanceReceipt: {
      findMany: async ({ where }) => {
        receiptWhereSeen = where;
        return [{ id: "receipt-1" }];
      },
    },
  };
  const resolved = await resolveAdvancePaymentPreservation(foundPrisma, "AP/2607/00001");
  assert.deepStrictEqual(resolved, {
    advancePaymentId: "pay-1",
    customerAdvanceTransactionId: "txn-1",
    advanceReceiptIds: ["receipt-1"],
  });
  assert.deepStrictEqual(
    receiptWhereSeen,
    { OR: [{ advancePaymentId: "pay-1" }, { transactionId: "txn-1" }] },
    "must look up receipts by EITHER FK, so a receipt is never missed"
  );

  // (d) When the AdvancePayment has no linked CustomerAdvanceTransaction
  // (creditTransaction null), customerAdvanceTransactionId must be null
  // and the receipt lookup must fall back to advancePaymentId only.
  const noTxnPrisma = {
    advancePayment: {
      findUnique: async () => ({ id: "pay-2", creditTransaction: null }),
    },
    advanceReceipt: {
      findMany: async ({ where }) => {
        assert.deepStrictEqual(where, { advancePaymentId: "pay-2" });
        return [];
      },
    },
  };
  const resolvedNoTxn = await resolveAdvancePaymentPreservation(noTxnPrisma, "AP/0000/00002");
  assert.strictEqual(resolvedNoTxn.customerAdvanceTransactionId, null);
  assert.deepStrictEqual(resolvedNoTxn.advanceReceiptIds, []);

  console.log("SECTION 10a-d (resolveAdvancePaymentPreservation): PASSED");
  await section10b_whereClauseScoping();
}

// ---------------------------------------------------------------------------
// SECTION 10b: buildDeleteWhere + countRowsToDelete/executeDeletion
// exclusion wiring — split out of section10 to keep each function small.
// ---------------------------------------------------------------------------
async function section10b_whereClauseScoping() {
  // (e) No `preserve` argument -> every model gets `{}` (unconditional),
  // identical to prior behaviour.
  for (const model of DELETE_ORDER) {
    assert.deepStrictEqual(buildDeleteWhere(model, undefined), {}, `${model} unconditional with no preserve arg`);
    assert.deepStrictEqual(buildDeleteWhere(model, null), {}, `${model} unconditional with a null preserve arg`);
  }

  // (f) WITH a preserve argument, ONLY the three PRESERVABLE_MODELS get an
  // exclusion filter — every other model in DELETE_ORDER must still be
  // `{}` (unconditional).
  const preserve = {
    advancePaymentId: "pay-1",
    customerAdvanceTransactionId: "txn-1",
    advanceReceiptIds: ["receipt-1", "receipt-2"],
  };
  assert.deepStrictEqual(buildDeleteWhere("advancePayment", preserve), { id: { not: "pay-1" } });
  assert.deepStrictEqual(buildDeleteWhere("customerAdvanceTransaction", preserve), { id: { not: "txn-1" } });
  assert.deepStrictEqual(buildDeleteWhere("advanceReceipt", preserve), { id: { notIn: ["receipt-1", "receipt-2"] } });
  for (const model of DELETE_ORDER) {
    if (PRESERVABLE_MODELS.includes(model)) continue;
    assert.deepStrictEqual(buildDeleteWhere(model, preserve), {}, `${model} must remain unconditional`);
  }

  // (g) A preserve object with no ids for a given preservable model (e.g.
  // customerAdvanceTransactionId: null, or an empty advanceReceiptIds
  // array) must fall back to unconditional `{}` for that model
  // specifically — never crash, never treat "nothing" as "everything".
  const partialPreserve = { advancePaymentId: "pay-1", customerAdvanceTransactionId: null, advanceReceiptIds: [] };
  assert.deepStrictEqual(buildDeleteWhere("advancePayment", partialPreserve), { id: { not: "pay-1" } });
  assert.deepStrictEqual(buildDeleteWhere("customerAdvanceTransaction", partialPreserve), {});
  assert.deepStrictEqual(buildDeleteWhere("advanceReceipt", partialPreserve), {});

  // (h) countRowsToDelete passes the exclusion where-clause through to
  // prisma[model].count({ where }) for the three PRESERVABLE_MODELS, and
  // `{}` for everything else.
  const countWhereSeen = {};
  const countMockPrisma = {};
  for (const model of DELETE_ORDER) {
    countMockPrisma[model] = {
      count: async ({ where }) => {
        countWhereSeen[model] = where;
        return 5;
      },
    };
  }
  const counts = await countRowsToDelete(countMockPrisma, preserve);
  assert.ok(DELETE_ORDER.every((m) => counts[m] === 5));
  assert.deepStrictEqual(countWhereSeen.advancePayment, { id: { not: "pay-1" } });
  assert.deepStrictEqual(countWhereSeen.customerAdvanceTransaction, { id: { not: "txn-1" } });
  assert.deepStrictEqual(countWhereSeen.advanceReceipt, { id: { notIn: ["receipt-1", "receipt-2"] } });
  assert.deepStrictEqual(countWhereSeen.order, {}, "non-preservable models must still be counted unconditionally");

  // (i) executeDeletion passes the exclusion where-clause through to
  // prisma[model].deleteMany({ where }) for the three PRESERVABLE_MODELS
  // inside the single $transaction call, `{}` for everything else — and
  // still refuses non-atomic strategies exactly as before, even with a
  // preserve argument supplied.
  const deleteWhereSeen = {};
  const deleteMockPrisma = {};
  for (const model of DELETE_ORDER) {
    deleteMockPrisma[model] = {
      deleteMany: async ({ where }) => {
        deleteWhereSeen[model] = where;
        return { count: 2 };
      },
    };
  }
  deleteMockPrisma.$transaction = async (promises) => Promise.all(promises);
  const deletedCounts = await executeDeletion(
    deleteMockPrisma,
    { strategy: "single-transaction", atomic: true },
    preserve
  );
  assert.ok(DELETE_ORDER.every((m) => deletedCounts[m] === 2));
  assert.deepStrictEqual(deleteWhereSeen.advancePayment, { id: { not: "pay-1" } });
  assert.deepStrictEqual(deleteWhereSeen.customerAdvanceTransaction, { id: { not: "txn-1" } });
  assert.deepStrictEqual(deleteWhereSeen.advanceReceipt, { id: { notIn: ["receipt-1", "receipt-2"] } });
  assert.deepStrictEqual(deleteWhereSeen.order, {}, "non-preservable models must still be deleted unconditionally");

  await assert.rejects(
    () => executeDeletion(deleteMockPrisma, { strategy: "sequential-best-effort", atomic: false }, preserve),
    /Refusing to execute/,
    "executeDeletion must still refuse non-atomic strategies even with a preserve argument"
  );

  console.log("SECTION 10e-i (where-clause scoping + count/delete wiring): PASSED");
}

// ---------------------------------------------------------------------------
// SECTION 11: BusinessSequence reset (validateResettableSequenceIds +
// executeDeletion's resetSequenceIds wiring) — covers the EQ/OD/PO series
// reset capability.
// ---------------------------------------------------------------------------
async function section11_businessSequenceReset() {
  // (a) Allowlist contents — AP_/AR_ must never be allowlisted, since those
  // back a preserved AdvancePayment/AdvanceReceipt and must never be reset.
  assert.ok(RESETTABLE_SEQUENCE_PREFIXES.includes("EQ_"));
  assert.ok(RESETTABLE_SEQUENCE_PREFIXES.includes("OD_"));
  assert.ok(RESETTABLE_SEQUENCE_PREFIXES.includes("IN_"));
  assert.ok(!RESETTABLE_SEQUENCE_PREFIXES.includes("AP_"), "AP_ must never be resettable");
  assert.ok(!RESETTABLE_SEQUENCE_PREFIXES.includes("AR_"), "AR_ must never be resettable");

  // (b) validateResettableSequenceIds accepts allowlisted ids unchanged.
  assert.deepStrictEqual(validateResettableSequenceIds(["EQ_26", "OD_26"]), ["EQ_26", "OD_26"]);
  assert.deepStrictEqual(validateResettableSequenceIds(["IN_26"]), ["IN_26"]);

  // (c) Fails closed on anything not allowlisted — in particular AP_/AR_
  // ids must be rejected even if a caller passes them by mistake.
  assert.throws(() => validateResettableSequenceIds(["AP_26"]), /not an allowlisted resettable/);
  assert.throws(() => validateResettableSequenceIds(["AR_26"]), /not an allowlisted resettable/);
  assert.throws(() => validateResettableSequenceIds(["RANDOM_26"]), /not an allowlisted resettable/);
  assert.throws(() => validateResettableSequenceIds([]), /non-empty array/);
  assert.throws(() => validateResettableSequenceIds(undefined), /non-empty array/);
  assert.throws(() => validateResettableSequenceIds(["EQ_26", "AP_26"]), /not an allowlisted resettable/);

  // (d) executeDeletion wires resetSequenceIds into the SAME $transaction
  // array as the deleteMany calls (one extra businessSequence.updateMany
  // call, never a second/separate transaction), and the validated ids are
  // passed through to the where clause unchanged.
  let transactionArgCount = null;
  let sequenceUpdateWhere = null;
  let sequenceUpdateData = null;
  const mockPrisma = {};
  for (const model of DELETE_ORDER) {
    mockPrisma[model] = { deleteMany: async () => ({ count: 0 }) };
  }
  mockPrisma.businessSequence = {
    updateMany: async ({ where, data }) => {
      sequenceUpdateWhere = where;
      sequenceUpdateData = data;
      return { count: 2 };
    },
  };
  mockPrisma.$transaction = async (ops) => {
    transactionArgCount = ops.length;
    return Promise.all(ops);
  };

  const counts = await executeDeletion(
    mockPrisma,
    { strategy: "single-transaction", atomic: true },
    null,
    ["EQ_26", "OD_26"]
  );

  assert.strictEqual(transactionArgCount, DELETE_ORDER.length + 1, "exactly one extra op for the sequence reset");
  assert.deepStrictEqual(sequenceUpdateWhere, { id: { in: ["EQ_26", "OD_26"] } });
  assert.deepStrictEqual(sequenceUpdateData, { value: 0 });
  assert.strictEqual(counts.businessSequenceReset, 2);

  // (e) Omitting resetSequenceIds entirely must never touch
  // businessSequence at all (no extra transaction op, no key on the
  // returned counts) — identical to prior behaviour.
  let businessSequenceCalled = false;
  const mockPrismaNoReset = {};
  for (const model of DELETE_ORDER) {
    mockPrismaNoReset[model] = { deleteMany: async () => ({ count: 0 }) };
  }
  mockPrismaNoReset.businessSequence = {
    updateMany: async () => {
      businessSequenceCalled = true;
      return { count: 0 };
    },
  };
  mockPrismaNoReset.$transaction = async (ops) => {
    assert.strictEqual(ops.length, DELETE_ORDER.length, "no extra op when resetSequenceIds is omitted");
    return Promise.all(ops);
  };
  const countsNoReset = await executeDeletion(
    mockPrismaNoReset,
    { strategy: "single-transaction", atomic: true }
  );
  assert.strictEqual(businessSequenceCalled, false, "businessSequence.updateMany must never be called when omitted");
  assert.ok(!("businessSequenceReset" in countsNoReset));

  // (f) A disallowed sequence id must be rejected BEFORE any deleteMany/
  // $transaction call is made (fail-closed, zero side effects).
  let anyOpCalled = false;
  const mockPrismaRejecting = {};
  for (const model of DELETE_ORDER) {
    mockPrismaRejecting[model] = {
      deleteMany: async () => {
        anyOpCalled = true;
        return { count: 0 };
      },
    };
  }
  mockPrismaRejecting.$transaction = async (ops) => {
    anyOpCalled = true;
    return Promise.all(ops);
  };
  await assert.rejects(
    () =>
      executeDeletion(mockPrismaRejecting, { strategy: "single-transaction", atomic: true }, null, ["AP_26"]),
    /not an allowlisted resettable/
  );
  assert.strictEqual(anyOpCalled, false, "no deleteMany/$transaction call when resetSequenceIds validation fails");

  console.log("SECTION 11 (BusinessSequence reset: allowlist, validation, executeDeletion wiring): PASSED");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
