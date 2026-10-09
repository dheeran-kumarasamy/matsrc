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
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "acct-1", buyerId: "buyer-1", availableBalance: 0, status: "ACTIVE" }]),
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
      data: { availableBalance: 50000 },
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(result.status).toBe("APPROVED");
  });

  it("is idempotent — approving an already-APPROVED payment does not re-credit the ledger", async () => {
    const { service, prisma } = buildService({ status: "APPROVED", approvedAt: new Date(), approvedBy: "admin-1" });

    const result = await service.approve("ap-1", "admin-2");

    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.status).toBe("APPROVED");
  });

  it("rejects approving a payment that is not PENDING/APPROVED (e.g. REJECTED)", async () => {
    const { service } = buildService({ status: "REJECTED" });

    await expect(service.approve("ap-1", "admin-1")).rejects.toThrow(BadRequestException);
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
