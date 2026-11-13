// Manual integration tests for AdvancePaymentsService.approve() against a
// REAL database. Not part of the default `vitest run` suite — follows the
// same env-var-gated, skipped-by-default convention as
// apps/api/src/common/enquiry-id.integration.manual.spec.ts. Unlike that
// file, these tests do NOT wrap setup in an outer `prisma.$transaction` —
// approve() opens its own internal transaction against the SAME
// PrismaClient/connection pool, and nesting it inside an outer, still-open
// transaction would deadlock (the inner transaction would block waiting on
// uncommitted row locks held by the outer one). Instead, setup data is
// committed directly and explicitly deleted in a `finally`/`afterEach`.
//
// Run manually via (from apps/api), using the dev-branch DATABASE_URL (NEVER
// production — see docs/database/migration-runbook.md):
//
//   RUN_ADVANCE_RECEIPT_INTEGRATION=true \
//   DATABASE_URL="<dev-branch-url>" \
//   pnpm exec vitest run src/admin/advance-payments/advance-payments-approve.integration.manual.spec.ts
//
// These tests exercise REAL Postgres transaction/rollback and REAL row-lock
// concurrency — guarantees the mocked unit tests in
// advance-payments.service.spec.ts cannot prove on their own.
import { afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@matsrc/db";
import { AdvancePaymentsService } from "./advance-payments.service";

const RUN_INTEGRATION = process.env.RUN_ADVANCE_RECEIPT_INTEGRATION === "true";

// Minimal no-op NotificationService stand-in — approve()/reject() only call
// sendWhatsApp() best-effort (fire-and-forget, failures swallowed), so a
// real NotificationService (with its own Twilio/queue dependency chain) is
// unnecessary here and would risk a real outbound WhatsApp send.
const fakeNotificationService = { sendWhatsApp: async () => undefined } as any;

function currentArSequenceKey(date: Date): string {
  const fyStartYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `AR_${String(fyStartYear % 100).padStart(2, "0")}`;
}

describe.skipIf(!RUN_INTEGRATION)("AdvancePaymentsService.approve — real database integration", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    if (createdUserIds.length === 0) return;
    const prisma = new PrismaClient();
    try {
      for (const buyerId of createdUserIds.splice(0)) {
        const account = await prisma.customerAdvanceAccount.findUnique({ where: { buyerId } });
        if (account) {
          await prisma.advanceReceipt.deleteMany({ where: { advanceAccountId: account.id } });
          await prisma.customerAdvanceTransaction.deleteMany({ where: { accountId: account.id } });
          await prisma.advancePayment.deleteMany({ where: { advanceAccountId: account.id } });
          await prisma.customerAdvanceAccount.delete({ where: { id: account.id } });
        }
        await prisma.user.delete({ where: { id: buyerId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rolls back the already-written CREDIT ledger row when receipt-number generation genuinely fails later in the SAME transaction", async () => {
    const prisma = new PrismaClient();
    try {
      const buyer = await prisma.user.create({
        data: { email: `advance-receipt-rollback-${Date.now()}@example.com`, name: "Rollback Test Buyer", role: "BUILDER" },
      });
      createdUserIds.push(buyer.id);
      const account = await prisma.customerAdvanceAccount.create({ data: { buyerId: buyer.id } });
      const payment = await prisma.advancePayment.create({
        data: {
          advanceAccountId: account.id,
          buyerId: buyer.id,
          referenceNumber: `AP/TEST/${Date.now()}`,
          amount: 1000,
          paymentMethod: "MANUAL",
          status: "PENDING",
          paymentReference: "TEST-UTR",
        },
      });

      // Force a genuine, deterministic failure strictly AFTER the CREDIT
      // ledger row has already been written inside approve()'s own
      // transaction: pre-exhaust the "AR_<fy>" BusinessSequence counter to
      // 99999 ahead of time, so createAdvanceReceipt's call to
      // nextBusinessSequence() increments it to 100000 and throws the real,
      // unmocked "exceeds the 5-digit serial capacity" error defined in
      // packages/db/lib/business-number.ts — strictly AFTER
      // appendLedgerEntry() already created the CREDIT row earlier in the
      // exact same transaction.
      const sequenceKey = currentArSequenceKey(new Date());
      const fyShort = sequenceKey.replace("AR_", "");
      const priorSeqRow = await prisma.businessSequence.findUnique({ where: { id: sequenceKey } });
      await prisma.businessSequence.upsert({
        where: { id: sequenceKey },
        update: { value: 99999 },
        create: { id: sequenceKey, type: "AR", fy: fyShort, value: 99999 },
      });

      const service = new AdvancePaymentsService(prisma as any, fakeNotificationService);

      try {
        await expect(service.approve(payment.id, "admin-test")).rejects.toThrow(/exceeds the 5-digit serial capacity/i);

        const unchangedPayment = await prisma.advancePayment.findUnique({ where: { id: payment.id } });
        expect(unchangedPayment?.status).toBe("PENDING");
        expect(unchangedPayment?.approvedAt).toBeNull();

        const creditRows = await prisma.customerAdvanceTransaction.findMany({
          where: { advancePaymentId: payment.id, type: "CREDIT" },
        });
        expect(creditRows).toHaveLength(0);

        const receiptRows = await prisma.advanceReceipt.findMany({ where: { advancePaymentId: payment.id } });
        expect(receiptRows).toHaveLength(0);

        const unchangedAccount = await prisma.customerAdvanceAccount.findUnique({ where: { id: account.id } });
        expect(Number(unchangedAccount?.availableBalance)).toBe(0);
      } finally {
        if (priorSeqRow) {
          await prisma.businessSequence.update({ where: { id: sequenceKey }, data: { value: priorSeqRow.value } });
        } else {
          await prisma.businessSequence.delete({ where: { id: sequenceKey } }).catch(() => undefined);
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("serializes two concurrent approve() calls for the same payment: exactly one CREDIT, one receipt, payment reaches APPROVED exactly once", async () => {
    const prisma = new PrismaClient();
    try {
      const buyer = await prisma.user.create({
        data: { email: `advance-receipt-concurrency-${Date.now()}@example.com`, name: "Concurrency Test Buyer", role: "BUILDER" },
      });
      createdUserIds.push(buyer.id);
      const account = await prisma.customerAdvanceAccount.create({ data: { buyerId: buyer.id } });
      const payment = await prisma.advancePayment.create({
        data: {
          advanceAccountId: account.id,
          buyerId: buyer.id,
          referenceNumber: `AP/TEST/${Date.now()}`,
          amount: 2500,
          paymentMethod: "MANUAL",
          status: "PENDING",
          paymentReference: "TEST-UTR-CONCURRENT",
        },
      });

      const service = new AdvancePaymentsService(prisma as any, fakeNotificationService);

      // Fire two concurrent approve() calls for the SAME payment id against
      // the SAME PrismaClient instance (real connection pool) — one of them
      // must either observe status === APPROVED via the re-read-inside-the-
      // transaction check and short-circuit as a no-op, or lose the row
      // lock race and fail. Either way, never two successful credits.
      const results = await Promise.allSettled([
        service.approve(payment.id, "admin-a"),
        service.approve(payment.id, "admin-b"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const finalPayment = await prisma.advancePayment.findUnique({ where: { id: payment.id } });
      expect(finalPayment?.status).toBe("APPROVED");

      const ledgerRows = await prisma.customerAdvanceTransaction.findMany({
        where: { advancePaymentId: payment.id, type: "CREDIT" },
      });
      expect(ledgerRows).toHaveLength(1);

      const receiptRows = await prisma.advanceReceipt.findMany({ where: { advancePaymentId: payment.id } });
      expect(receiptRows).toHaveLength(1);
      expect(receiptRows[0].transactionId).toBe(ledgerRows[0].id);

      // Exactly one net CREDIT of the original amount — balance reflects a
      // single settlement, not a double-credit.
      const refreshedAccount = await prisma.customerAdvanceAccount.findUnique({ where: { id: account.id } });
      expect(Number(refreshedAccount?.availableBalance)).toBe(2500);
    } finally {
      await prisma.$disconnect();
    }
  });
});


