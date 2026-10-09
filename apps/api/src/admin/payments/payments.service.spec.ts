import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PaymentsService } from "./payments.service";

function buildService(overrides: Partial<any> = {}) {
  const verification = {
    id: "pv-1",
    orderId: "order-1",
    userId: "user-1",
    paymentMethod: "BANK_TRANSFER",
    amount: 5000,
    status: "PENDING",
    screenshotFileName: "payment-proof-order-1.png",
    submittedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    order: { id: "order-1", status: "PLACED", totalAmount: 5000, paymentMethod: "BANK_TRANSFER" },
    ...overrides,
  };

  const prisma: any = {
    paymentVerification: {
      findUnique: vi.fn().mockResolvedValue(verification),
      findMany: vi.fn().mockResolvedValue([verification]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...verification, ...data })),
    },
    order: {
      update: vi.fn().mockResolvedValue({}),
      // Business Numbering (EQ/OD/IN) support (see
      // packages/db/lib/business-number.ts) — approve() reads the order's
      // existing orderNumber before deciding whether to generate a new one.
      findUnique: vi.fn().mockResolvedValue({ orderNumber: null }),
    },
    orderTracking: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: "user-1", name: "Builder", email: "b@x.com", phone: "9876543210" }),
    },
    businessSequence: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ value: 1 }),
    },
    // Advance Balance reservation consumption/release (see
    // packages/db/lib/advance-ledger.ts) — approve()/reject() both look up
    // the buyer's advance account and (no-op) consume/release any ACTIVE
    // reservation for the order. No advance account by default (most
    // payment tests don't involve advance balance at all).
    customerAdvanceAccount: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    advanceReservation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    customerAdvanceTransaction: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "acct-1", availableBalance: 0, reservedBalance: 0 }]),
  };
  // Both approve() and reject() use the callback-style $transaction((tx) =>
  // ...) shape — the same `tx` client is reused for generateOrderNumber()
  // and the advance-reservation consume/release helpers.
  prisma.$transaction = vi.fn().mockImplementation((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));

  const notificationService = { sendWhatsApp: vi.fn().mockResolvedValue(undefined) };
  const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(prisma as any, notificationService as any, customerOrderStatusNotificationService as any);
  return { service, prisma, notificationService, customerOrderStatusNotificationService, verification };
}

describe("PaymentsService.approve", () => {
  it("throws NotFoundException when no verification exists for the order", async () => {
    const { service, prisma } = buildService();
    prisma.paymentVerification.findUnique = vi.fn().mockResolvedValue(null);

    await expect(service.approve("missing-order", "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("approves a PENDING payment, marks the order PAID/PROCESSING and records the reviewer", async () => {
    const { service, prisma } = buildService();

    const result = await service.approve("order-1", "admin-1");

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1" },
        data: expect.objectContaining({ paymentStatus: "PAID", status: "PROCESSING" }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(result.status).toBe("APPROVED");
  });

  it("is idempotent — approving an already-APPROVED payment does not re-trigger the order transition", async () => {
    const { service, prisma } = buildService({ status: "APPROVED", reviewedAt: new Date(), reviewedBy: "admin-1" });

    const result = await service.approve("order-1", "admin-2");

    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.status).toBe("APPROVED");
  });

  it("rejects approving a payment that is not PENDING/APPROVED (e.g. REJECTED)", async () => {
    const { service } = buildService({ status: "REJECTED" });

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("consumes an ACTIVE advance reservation atomically when approving (fixes the original bug)", async () => {
    const { service, prisma } = buildService();
    prisma.customerAdvanceAccount.findFirst.mockResolvedValue({ id: "acct-1" });
    prisma.$queryRaw.mockResolvedValue([{ id: "acct-1", availableBalance: 50000, reservedBalance: 20000 }]);
    prisma.advanceReservation.findUnique.mockResolvedValue({
      id: "res-1",
      orderId: "order-1",
      advanceAccountId: "acct-1",
      amount: 20000,
      status: "ACTIVE",
    });

    await service.approve("order-1", "admin-1");

    expect(prisma.customerAdvanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ORDER_PAYMENT", orderId: "order-1" }) })
    );
    expect(prisma.advanceReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: "order-1" }, data: expect.objectContaining({ status: "CONSUMED" }) })
    );
  });

  it("does not touch the advance ledger when the buyer has no advance account", async () => {
    const { service, prisma } = buildService();

    await service.approve("order-1", "admin-1");

    expect(prisma.customerAdvanceAccount.findFirst).toHaveBeenCalled();
    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
  });
});

describe("PaymentsService.reject", () => {
  it("rejects a PENDING payment, stores the reason and resets paymentStatus to PENDING", async () => {
    const { service, prisma } = buildService();

    const result = await service.reject("order-1", "admin-1", "Screenshot amount mismatch");

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "order-1" }, data: { paymentStatus: "PENDING" } })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "PAYMENT_VERIFICATION_REJECTED" }),
      })
    );
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe("Screenshot amount mismatch");
  });

  it("throws BadRequestException when trying to reject an already-APPROVED payment", async () => {
    const { service } = buildService({ status: "APPROVED" });

    await expect(service.reject("order-1", "admin-1", "reason")).rejects.toThrow(BadRequestException);
  });

  it("does not send a duplicate rejection notification when rejecting an already-REJECTED payment again", async () => {
    const { service, notificationService } = buildService({
      status: "REJECTED",
      rejectionReason: "old reason",
    });

    await service.reject("order-1", "admin-1", "new reason");

    expect(notificationService.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("releases an ACTIVE advance reservation atomically when rejecting (fixes the original bug)", async () => {
    const { service, prisma } = buildService();
    prisma.customerAdvanceAccount.findFirst.mockResolvedValue({ id: "acct-1" });
    prisma.$queryRaw.mockResolvedValue([{ id: "acct-1", availableBalance: 30000, reservedBalance: 20000 }]);
    prisma.advanceReservation.findUnique.mockResolvedValue({
      id: "res-1",
      orderId: "order-1",
      advanceAccountId: "acct-1",
      amount: 20000,
      status: "ACTIVE",
    });

    await service.reject("order-1", "admin-1", "Screenshot amount mismatch");

    expect(prisma.customerAdvanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ADVANCE_RELEASE", orderId: "order-1" }) })
    );
    expect(prisma.advanceReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: "order-1" }, data: expect.objectContaining({ status: "RELEASED" }) })
    );
  });

  it("does not touch the advance ledger when rejecting an order with no advance reservation", async () => {
    const { service, prisma } = buildService();

    await service.reject("order-1", "admin-1", "reason");

    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
  });
});
