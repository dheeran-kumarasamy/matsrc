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
    order: { id: "order-1", status: "PLACED", totalAmount: 5000, paymentMethod: "BANK_TRANSFER", enquiryId: "EQ/2601/00001" },
    ...overrides,
  };

  // Default single line item for GST-snapshot resolution (Phase 4.2) — a
  // ₹5000 line, 10% markup already resolved at checkout (mirrors
  // OrdersService.updateStatus's own test fixture shape), so
  // resolveOrderConfirmationSnapshot can run to completion for every
  // "genuine confirmation" (order currently PLACED) test case by default.
  const orderItems = [
    {
      id: "item-1",
      productId: "prod-1",
      quantity: 1,
      unitPrice: 5000,
      supplierUnitPrice: 5000,
      markupPercent: 0,
      product: { categoryId: "cat-1" },
    },
  ];

  const prisma: any = {
    paymentVerification: {
      findUnique: vi.fn().mockResolvedValue(verification),
      findMany: vi.fn().mockResolvedValue([verification]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...verification, ...data })),
    },
    order: {
      // Two distinct conditional updateMany calls exist in approve():
      // (1) the confirmation-claim guard (`where: { status: "PLACED" }`,
      //     only for a genuine PLACED -> PROCESSING transition), and
      // (2) the Phase 4.4 payment-approval-eligibility guard (`where: {
      //     status: { not: "CANCELLED" } }`, inside writeApprovalSideEffects,
      //     always runs). Each must be independently controllable per test —
      //     a lost-race test setting "the confirmation claim lost" must NOT
      //     also make the (unrelated) eligibility guard report zero rows.
      updateMany: vi.fn().mockImplementation(async (args: any) =>
        // Default: every conditional updateMany succeeds (count: 1).
        // Tests override this per-call by re-assigning
        // prisma.order.updateMany.mockImplementation(...) to branch on
        // args.where.status, since two DISTINCT conditional updateMany
        // calls exist in approve(): (1) the confirmation-claim guard
        // (`where: { status: "PLACED" }`) and (2) the Phase 4.4
        // payment-approval-eligibility guard (`where: { status: { not:
        // "CANCELLED" } } }`, inside writeApprovalSideEffects, which
        // always runs regardless of branch).
        ({ count: 1 })
      ),
      update: vi.fn().mockResolvedValue({}),
      // Polymorphic based on the query shape, mirroring
      // apps/api/src/supplier/orders/orders.service.spec.ts's identical
      // pattern — approve() makes three distinct kinds of order.findUnique
      // calls: (1) `select: { orderNumber }` for Business Numbering, (2)
      // `include: { items: { include: { product } } }` to resolve the GST
      // snapshot for a genuine confirmation, (3) a plain/`select` call for
      // the legacy-snapshot-consistency check and the lost-race recovery
      // re-read.
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        if (args?.select?.orderNumber !== undefined && Object.keys(args.select).length === 1) {
          return { orderNumber: null };
        }
        if (args?.select?.status !== undefined && Object.keys(args.select).length === 1) {
          // writeApprovalSideEffects' own read of the just-approved order's
          // current status (for the OrderTracking note) — PROCESSING by
          // default, matching every genuine-confirmation test's expectation.
          return { status: "PROCESSING" };
        }
        if (args?.include?.items?.include?.product) {
          return { id: "order-1", items: orderItems };
        }
        if (args?.select?.taxAmount !== undefined || args?.select?.items) {
          // Legacy/retry-safety branch (non-genuine confirmation) — now also
          // fetches items for assertFullOrderSnapshotIntegrity (Phase 4.4).
          return {
            totalAmount: 5000,
            taxAmount: null,
            finalPayableAmount: null,
            advancePercent: null,
            requiredAdvanceAmount: null,
            items: [],
          };
        }
        // Plain findUnique({ where: { id } }) with an `include: { items }`
        // for the lost-race recovery path's re-read of the already-
        // finalized order (Phase 4.4 also validates its full snapshot).
        return {
          id: "order-1",
          status: "PROCESSING",
          totalAmount: 5000,
          taxAmount: 500,
          finalPayableAmount: 5500,
          advancePercent: null,
          requiredAdvanceAmount: null,
          items: [{ id: "item-1", taxRatePercent: 10, taxAmount: 500 }],
        };
      }),
    },
    orderItem: {
      update: vi.fn().mockResolvedValue({}),
    },
    // GST resolution (Phase 4.2) — a single enabled GLOBAL 10% TaxSetting
    // by default, so resolveOrderConfirmationSnapshot succeeds for the
    // default single-line fixture above without every existing test needing
    // to configure GST explicitly. No AdvanceConfig by default (matches the
    // rest of this codebase's "advance is optional/informational" contract).
    taxSetting: {
      findMany: vi.fn().mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true }]),
    },
    advanceConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
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

  it("rejects approval of a CANCELLED order without touching payment verification, payment status, reservation, tracking, or audit (fast-fail path)", async () => {
    const { service, prisma } = buildService({
      order: { id: "order-1", status: "CANCELLED", totalAmount: 5000, paymentMethod: "BANK_TRANSFER", enquiryId: "EQ/2601/00001" },
    });

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(BadRequestException);
    expect(prisma.paymentVerification.update).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.orderTracking.create).not.toHaveBeenCalled();
    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects approval when the order becomes CANCELLED between the initial read and the write (eligibility re-checked atomically inside the transaction)", async () => {
    const { service, prisma } = buildService();
    // The initial read (verification.order.status) still says PLACED, so
    // isGenuineConfirmation resolves the GST snapshot normally and the
    // confirmation-claim updateMany succeeds — but the order has since
    // been cancelled by a concurrent request, so the Phase 4.4 eligibility
    // updateMany (status: { not: "CANCELLED" }) must catch it.
    prisma.order.updateMany.mockImplementation(async (args: any) =>
      args?.where?.status === "PLACED" ? { count: 1 } : { count: 0 }
    );

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(BadRequestException);
    expect(prisma.paymentVerification.update).not.toHaveBeenCalled();
    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("approves a PENDING payment, marks the order PAID/PROCESSING and records the reviewer", async () => {
    const { service, prisma } = buildService();

    const result = await service.approve("order-1", "admin-1");

    // Product-Level GST / GST-Inclusive Buyer Payable (Phase 4.2): the
    // PLACED -> PROCESSING status transition (plus the frozen GST snapshot)
    // is now written via the conditional updateMany concurrency guard, not
    // the unconditional order.update — mirrors OrdersService.updateStatus's
    // identical pattern for this same transition.
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", status: "PLACED" },
        data: expect.objectContaining({ status: "PROCESSING" }),
      })
    );
    // paymentStatus remains this function's own, unraced write — now
    // folded into the Phase 4.4 payment-approval-eligibility updateMany.
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", status: { not: "CANCELLED" } },
        data: { paymentStatus: "PAID" },
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(result.status).toBe("APPROVED");
  });

  it("freezes the GST-inclusive snapshot (taxAmount/finalPayableAmount) onto Order and taxRatePercent/taxAmount onto OrderItem for a genuine PLACED -> PROCESSING approval", async () => {
    const { service, prisma } = buildService();

    await service.approve("order-1", "admin-1");

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxAmount: 500, finalPayableAmount: 5500, advancePercent: null, requiredAdvanceAmount: null }),
      })
    );
    expect(prisma.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "item-1" },
        data: expect.objectContaining({ taxRatePercent: 10, taxAmount: 500 }),
      })
    );
  });

  it("blocks approval with no partial writes when no GST configuration exists for a genuine confirmation", async () => {
    const { service, prisma } = buildService();
    prisma.taxSetting.findMany.mockResolvedValue([]);

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(BadRequestException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
    expect(prisma.paymentVerification.update).not.toHaveBeenCalled();
  });

  it("does not re-resolve or rewrite the snapshot for an order already past PLACED (legacy/retry safety)", async () => {
    const { service, prisma } = buildService({ order: { id: "order-1", status: "PROCESSING", totalAmount: 5000, paymentMethod: "BANK_TRANSFER", enquiryId: "EQ/2601/00001" } });

    await service.approve("order-1", "admin-1");

    // No confirmation-CLAIM updateMany (keyed on status: "PLACED") for a
    // non-genuine confirmation — only the Phase 4.4 eligibility updateMany
    // (keyed on status: { not: "CANCELLED" }) runs, which is a different
    // call entirely.
    expect(prisma.order.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "PLACED" }) })
    );
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
    // paymentStatus is still applied — this is this function's own job.
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", status: { not: "CANCELLED" } },
        data: { paymentStatus: "PAID" },
      })
    );
  });

  it("loses a concurrent confirmation race safely: applies payment-verification approval without rewriting the winner's snapshot or sending a duplicate transition notification", async () => {
    const { service, prisma, customerOrderStatusNotificationService } = buildService();
    // Only the confirmation-CLAIM updateMany (keyed on status: "PLACED")
    // loses — the Phase 4.4 eligibility updateMany (keyed on status: {
    // not: "CANCELLED" }) must still succeed, since the winner's order is
    // PROCESSING (not CANCELLED) per the lost-race re-read fixture.
    prisma.order.updateMany.mockImplementation(async (args: any) =>
      args?.where?.status === "PLACED" ? { count: 0 } : { count: 1 }
    );

    const result = await service.approve("order-1", "admin-1");

    expect(result.status).toBe("APPROVED");
    // The winner's snapshot (taxAmount 500 / finalPayableAmount 5500, from
    // the lost-race re-read fixture) is never overwritten by a second
    // updateMany/orderItem.update from this losing request.
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
    // This function's own, unraced writes (payment-verification approval,
    // paymentStatus, advance consumption, audit log) still happen exactly
    // once via the recovery transaction.
    expect(prisma.paymentVerification.update).toHaveBeenCalledTimes(1);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", status: { not: "CANCELLED" } },
        data: { paymentStatus: "PAID" },
      })
    );
    // Never a duplicate order-status transition notification for a
    // transition this request did not itself cause.
    expect(customerOrderStatusNotificationService.notifyIfTransitioned).not.toHaveBeenCalled();
  });

  it("rejects approval when the winning order has since become CANCELLED (lost-race winner ineligible)", async () => {
    const { service, prisma } = buildService();
    prisma.order.updateMany.mockImplementation(async (args: any) =>
      args?.where?.status === "PLACED" ? { count: 0 } : { count: 1 }
    );
    prisma.order.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.orderNumber !== undefined && Object.keys(args.select).length === 1) {
        return { orderNumber: null };
      }
      // Lost-race re-read: the winner's order is now CANCELLED.
      return {
        id: "order-1",
        status: "CANCELLED",
        totalAmount: 5000,
        taxAmount: null,
        finalPayableAmount: null,
        advancePercent: null,
        requiredAdvanceAmount: null,
        items: [],
      };
    });

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(BadRequestException);
    expect(prisma.paymentVerification.update).not.toHaveBeenCalled();
    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects approval when the lost-race winner's snapshot is inconsistent (partial snapshot), before any approval side effect", async () => {
    const { service, prisma } = buildService();
    prisma.order.updateMany.mockImplementation(async (args: any) =>
      args?.where?.status === "PLACED" ? { count: 0 } : { count: 1 }
    );
    prisma.order.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.orderNumber !== undefined && Object.keys(args.select).length === 1) {
        return { orderNumber: null };
      }
      // Lost-race re-read: the winner committed a PARTIAL (inconsistent)
      // snapshot — taxAmount set but finalPayableAmount null.
      return {
        id: "order-1",
        status: "PROCESSING",
        totalAmount: 5000,
        taxAmount: 500,
        finalPayableAmount: null,
        advancePercent: null,
        requiredAdvanceAmount: null,
        items: [],
      };
    });

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(/inconsistent financial snapshot/i);
    expect(prisma.paymentVerification.update).not.toHaveBeenCalled();
    expect(prisma.customerAdvanceTransaction.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects approval when the lost-race winner's order-level snapshot is complete but a line item is missing its snapshot", async () => {
    const { service, prisma } = buildService();
    prisma.order.updateMany.mockImplementation(async (args: any) =>
      args?.where?.status === "PLACED" ? { count: 0 } : { count: 1 }
    );
    prisma.order.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.orderNumber !== undefined && Object.keys(args.select).length === 1) {
        return { orderNumber: null };
      }
      if (args?.include?.items?.include?.product) {
        return { id: "order-1", items: [{ id: "item-1", productId: "prod-1", quantity: 1, unitPrice: 5000, supplierUnitPrice: 5000, markupPercent: 0, product: { categoryId: "cat-1" } }] };
      }
      return {
        id: "order-1",
        status: "PROCESSING",
        totalAmount: 5000,
        taxAmount: 500,
        finalPayableAmount: 5500,
        advancePercent: null,
        requiredAdvanceAmount: null,
        items: [{ id: "item-1", taxRatePercent: null, taxAmount: null }],
      };
    });

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(/inconsistent financial snapshot/i);
    expect(prisma.paymentVerification.update).not.toHaveBeenCalled();
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

  it("losing a confirmation race still consumes the ACTIVE advance reservation exactly once (no duplicate ORDER_PAYMENT entry)", async () => {
    const { service, prisma } = buildService();
    prisma.order.updateMany.mockImplementation(async (args: any) =>
      args?.where?.status === "PLACED" ? { count: 0 } : { count: 1 }
    );
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

    expect(prisma.customerAdvanceTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.customerAdvanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ORDER_PAYMENT", orderId: "order-1" }) })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rolls back all snapshot writes when the transaction fails for a reason other than a lost race", async () => {
    const { service, prisma } = buildService();
    prisma.$transaction = vi.fn().mockImplementation(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      throw new Error("DB connection lost mid-transaction");
    });

    await expect(service.approve("order-1", "admin-1")).rejects.toThrow(/DB connection lost/);
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
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
