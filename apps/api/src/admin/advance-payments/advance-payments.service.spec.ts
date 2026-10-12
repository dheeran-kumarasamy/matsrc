import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdvancePaymentsService } from "./advance-payments.service";

function buildService(overrides: Partial<any> = {}) {
  const payment = {
    id: "ap-1",
    advanceAccountId: "acct-1",
    buyerId: "buyer-1",
    referenceNumber: "AP/2601/00001",
    amount: 50000,
    paymentMethod: "MANUAL",
    status: "PENDING",
    paymentReference: "UTR123456",
    submittedAt: new Date(),
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    buyer: { id: "buyer-1", name: "Builder", email: "b@x.com", phone: "9876543210" },
    ...overrides,
  };

  const prisma: any = {
    advancePayment: {
      findUnique: vi.fn().mockResolvedValue(payment),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...payment, ...data })),
    },
    customerAdvanceAccount: {
      update: vi.fn().mockResolvedValue({}),
    },
    customerAdvanceTransaction: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "tx-1", ...data })),
    },
    advanceReceipt: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "receipt-1", ...data })),
    },
    businessSequence: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ value: 1 }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "acct-1", buyerId: "buyer-1", availableBalance: 0, reservedBalance: 0, status: "ACTIVE" }]),
  };
  prisma.$transaction = vi.fn().mockImplementation((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));

  const notificationService = { sendWhatsApp: vi.fn().mockResolvedValue(undefined) };

  const service = new AdvancePaymentsService(prisma as any, notificationService as any);
  return { service, prisma, notificationService, payment };
}

describe("AdvancePaymentsService.approve", () => {
  it("throws NotFoundException when no advance payment exists", async () => {
    const { service, prisma } = buildService();
    prisma.advancePayment.findUnique = vi.fn().mockResolvedValue(null);

    await expect(service.approve("missing", "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("approves a PENDING payment, credits the ledger exactly once and records the approver", async () => {
    const { service, prisma } = buildService();

    const result = await service.approve("ap-1", "admin-1");

    expect(prisma.customerAdvanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "CREDIT", amount: 50000, accountId: "acct-1" }) })
    );
    expect(prisma.customerAdvanceAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { availableBalance: 50000, reservedBalance: 0 },
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(result.status).toBe("APPROVED");
  });

  // Advance Payment Receipt — generated atomically alongside the CREDIT
  // ledger entry (see createAdvanceReceipt in packages/db/lib/advance-ledger.ts).
  it("generates exactly one AdvanceReceipt, referencing the newly-created CREDIT transaction and the settled amount", async () => {
    const { service, prisma } = buildService();

    const result = await service.approve("ap-1", "admin-1");

    expect(prisma.advanceReceipt.create).toHaveBeenCalledTimes(1);
    expect(prisma.advanceReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionId: "tx-1",
          advanceAccountId: "acct-1",
          buyerId: "buyer-1",
          advancePaymentId: "ap-1",
          amount: 50000,
          balanceAfter: 50000,
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ receiptId: "receipt-1", receiptNumber: expect.stringMatching(/^AR\/\d{4}\/\d{5}$/) }),
        }),
      })
    );
    expect(result.status).toBe("APPROVED");
  });

  it("is idempotent — approving an already-APPROVED payment does not re-credit the ledger or create a duplicate receipt", async () => {
    const { service, prisma } = buildService({ status: "APPROVED", approvedAt: new Date(), approvedBy: "admin-1" });

    const result = await service.approve("ap-1", "admin-2");

    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
    expect(prisma.advanceReceipt.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.status).toBe("APPROVED");
  });

  // Rollback-on-failure (MOCKED evidence only — see the note below and the
  // separate real-database integration test in
  // advance-payments-approve.integration.manual.spec.ts for actual Postgres
  // rollback proof). This test only proves that:
  //   1. a thrown error from advanceReceipt.create() propagates out of
  //      approve() instead of being swallowed, and
  //   2. no step AFTER the failing call (advancePayment.update to APPROVED,
  //      auditLog.create) is ever reached.
  // It does NOT and CANNOT prove that a real database transaction actually
  // rolls back the CREDIT ledger row or the balance update that happened
  // BEFORE the failure — the mock buildService() below uses a sequential,
  // non-transactional $transaction shim (`(arg) => arg(prisma)`) with no
  // real ROLLBACK semantics, so any assertion that the ledger row "was
  // rolled back" from this mock alone would be unverified. Real atomicity
  // is a property of Postgres + Prisma's interactive transactions, verified
  // separately in the manual integration spec.
  it("propagates a receipt-creation failure and never reaches the APPROVED update or audit log afterward (mocked — does not prove real DB rollback)", async () => {
    const { service, prisma } = buildService();
    const receiptError = new Error("simulated advanceReceipt.create failure");
    prisma.advanceReceipt.create.mockRejectedValueOnce(receiptError);

    await expect(service.approve("ap-1", "admin-1")).rejects.toThrow(receiptError);

    // The CREDIT ledger row IS created before the simulated failure (that's
    // the point of the test — receipt creation happens strictly after the
    // ledger write) — but nothing downstream of the failure point ever
    // runs: the payment is never flipped to APPROVED, and no audit log
    // entry for the approval is ever written.
    expect(prisma.customerAdvanceTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.advancePayment.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects approving a payment that is not PENDING/APPROVED (e.g. REJECTED)", async () => {
    const { service } = buildService({ status: "REJECTED" });

    await expect(service.approve("ap-1", "admin-1")).rejects.toThrow(BadRequestException);
  });
});

describe("AdvancePaymentsService.getReceipt", () => {
  it("returns the existing AdvanceReceipt for an approved advance payment, including the payment's reference number", async () => {
    const { service, prisma } = buildService();
    const storedReceipt = {
      id: "receipt-1",
      receiptNumber: "AR/2601/00001",
      issuedAt: new Date(),
      amount: 50000,
      balanceAfter: 50000,
      currency: "INR",
      paymentMethod: "MANUAL",
      paymentReferenceNo: "UTR123456",
      buyerName: "Builder",
      buyerEmail: "b@x.com",
      buyerPhone: "9876543210",
      advancePaymentId: "ap-1",
      advancePayment: { referenceNumber: "AP/2601/00001" },
    };
    prisma.advanceReceipt.findFirst = vi.fn().mockResolvedValue(storedReceipt);

    const receipt = await service.getReceipt("ap-1");

    expect(prisma.advanceReceipt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { advancePaymentId: "ap-1" } })
    );
    expect(receipt).toEqual(storedReceipt);
  });

  it("throws NotFoundException when the advance payment has no receipt (e.g. still PENDING/REJECTED)", async () => {
    const { service, prisma } = buildService();
    prisma.advanceReceipt.findFirst = vi.fn().mockResolvedValue(null);

    await expect(service.getReceipt("ap-not-approved")).rejects.toThrow(NotFoundException);
  });

  it("never creates or mutates a receipt — getReceipt is strictly read-only", async () => {
    const { service, prisma } = buildService();
    prisma.advanceReceipt.findFirst = vi.fn().mockResolvedValue({ id: "receipt-1", receiptNumber: "AR/2601/00001" });

    await service.getReceipt("ap-1");

    expect(prisma.advanceReceipt.create).not.toHaveBeenCalled();
    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
  });
});

describe("AdvancePaymentsService.reject", () => {
  it("rejects a PENDING payment and stores the reason without crediting the ledger", async () => {
    const { service, prisma } = buildService();

    const result = await service.reject("ap-1", "admin-1", "Screenshot amount mismatch");

    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ADVANCE_PAYMENT_REJECTED" }) })
    );
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe("Screenshot amount mismatch");
  });

  it("throws BadRequestException when trying to reject an already-APPROVED payment", async () => {
    const { service } = buildService({ status: "APPROVED" });

    await expect(service.reject("ap-1", "admin-1", "reason")).rejects.toThrow(BadRequestException);
  });

  it("does not send a duplicate rejection notification when rejecting an already-REJECTED payment again", async () => {
    const { service, notificationService } = buildService({ status: "REJECTED", rejectionReason: "old reason" });

    await service.reject("ap-1", "admin-1", "new reason");

    expect(notificationService.sendWhatsApp).not.toHaveBeenCalled();
  });
});
