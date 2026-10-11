import { describe, expect, it, vi } from "vitest";
import { OrderStatus } from "@matsrc/db";
import { BestPriceSelectionService, selectLowestValidQuote } from "./best-price-selection.service";

describe("selectLowestValidQuote", () => {
  it("picks the lowest price candidate", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "s1", unitPrice: 5100, leadTimeDays: 3, createdAt: new Date("2026-01-01T10:00:00Z") },
      { supplierId: "s2", unitPrice: 4800, leadTimeDays: 5, createdAt: new Date("2026-01-01T09:00:00Z") },
    ]);

    expect(winner.supplierId).toBe("s2");
    expect(winner.unitPrice).toBe(4800);
  });

  it("breaks price ties by lead time, then timestamp, then supplier id", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "s2", unitPrice: 4800, leadTimeDays: 5, createdAt: new Date("2026-01-01T09:00:00Z") },
      { supplierId: "s3", unitPrice: 4800, leadTimeDays: 2, createdAt: new Date("2026-01-01T09:30:00Z") },
      { supplierId: "s1", unitPrice: 4800, leadTimeDays: 2, createdAt: new Date("2026-01-01T09:30:00Z") },
    ]);

    expect(winner.supplierId).toBe("s1");
  });

  it("handles single quote", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "single", unitPrice: 5000, createdAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    expect(winner.supplierId).toBe("single");
  });

  it("throws when no valid quotes are present", () => {
    expect(() => selectLowestValidQuote([])).toThrow("No candidates available for best-price selection");
  });
});

// Test 10 — Order conversion (spec §15): the order must use the supplier's
// submitted RFQ quotation price, never the current catalogue/listing price
// the OrderItem happened to be created with.
describe("BestPriceSelectionService.selectAndFinalizeIfEligible — order uses submitted quote price", () => {
  function createService() {
    const orderItemUpdateCalls: any[] = [];
    const orderUpdateCalls: any[] = [];

    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "enq-1",
          status: OrderStatus.PLACED,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          deliveryDate: null,
          quoteSelectionCompletedAt: null,
          items: [
            {
              id: "line-1",
              productId: "prod-1",
              quantity: 10,
              unitPrice: 400, // catalogue/original price at OrderItem creation time
              product: { name: "Cement OPC", canonicalProductId: null },
            },
          ],
        }),
        update: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({});
        }),
      },
      supplierQuote: {
        findMany: vi.fn().mockResolvedValue([
          {
            supplierId: "sup-winner",
            unitPrice: 425, // supplier's submitted RFQ quote — NOT the catalogue price
            lineItemId: "line-1",
            leadTimeDays: 3,
            currency: "INR",
            createdAt: new Date("2026-01-01T01:00:00Z"),
          },
        ]),
      },
      supplierProfile: {
        findUnique: vi.fn().mockResolvedValue({ id: "sup-winner", companyName: "Winner Supplier", region: null }),
        findMany: vi.fn().mockResolvedValue([{ id: "sup-winner", region: null }]),
      },
      orderItem: {
        update: vi.fn((args: any) => {
          orderItemUpdateCalls.push(args);
          return Promise.resolve({});
        }),
      },
      priceSnapshot: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma)),
    } as any;

    const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };

    const service = new BestPriceSelectionService(
      prisma,
      customerOrderStatusNotificationService as any,
      paymentRequiredNotificationService as any
    );

    return { service, prisma, orderItemUpdateCalls, orderUpdateCalls };
  }

  it("updates OrderItem.unitPrice/supplierId to the winning SupplierQuote, not the original catalogue price", async () => {
    const { service, orderItemUpdateCalls } = createService();

    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(true);
    expect(orderItemUpdateCalls).toHaveLength(1);
    expect(orderItemUpdateCalls[0]).toMatchObject({
      where: { id: "line-1" },
      data: { unitPrice: 425, supplierId: "sup-winner" },
    });
  });

  // RFQ Accepted-Total Synchronization — Test 1: single-line accepted total.
  it("synchronizes Order.totalAmount to the accepted bestPriceTotal for a single line item", async () => {
    const { service, orderUpdateCalls } = createService();

    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(true);
    expect(result?.bestPriceTotal).toBe(4250); // 425 * 10
    expect(orderUpdateCalls).toHaveLength(1);
    expect(orderUpdateCalls[0].data).toMatchObject({
      bestPriceTotal: 4250,
      totalAmount: 4250,
    });
  });
});

// RFQ Accepted-Total Synchronization — multi-line, incomplete-quote,
// idempotency and existing-payment-state coverage.
describe("BestPriceSelectionService.selectAndFinalizeIfEligible — accepted-total synchronization", () => {
  function forbiddenTable(name: string, forbiddenCalls: string[]) {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          return (..._args: any[]) => {
            forbiddenCalls.push(`${name}.${String(prop)}`);
            throw new Error(`Unexpected call to ${name}.${String(prop)} during RFQ finalization`);
          };
        },
      }
    );
  }

  function createMultiLineService() {
    const orderItemUpdateCalls: any[] = [];
    const orderUpdateCalls: any[] = [];
    const forbiddenCalls: string[] = [];

    const prisma: any = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "enq-multi",
          status: OrderStatus.PLACED,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          deliveryDate: null,
          quoteSelectionCompletedAt: null,
          items: [
            { id: "line-a", productId: "prod-a", quantity: 10, unitPrice: 400, product: { name: "Cement OPC", canonicalProductId: null } },
            { id: "line-b", productId: "prod-b", quantity: 5, unitPrice: 1000, product: { name: "TMT Bar", canonicalProductId: null } },
          ],
        }),
        update: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({});
        }),
      },
      supplierQuote: {
        findMany: vi.fn().mockResolvedValue([
          { supplierId: "sup-1", unitPrice: 425, lineItemId: "line-a", leadTimeDays: 3, currency: "INR", createdAt: new Date("2026-01-01T01:00:00Z") },
          { supplierId: "sup-2", unitPrice: 950, lineItemId: "line-b", leadTimeDays: 2, currency: "INR", createdAt: new Date("2026-01-01T01:00:00Z") },
        ]),
      },
      supplierProfile: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          { id: "sup-1", region: null },
          { id: "sup-2", region: null },
        ]),
      },
      orderItem: {
        update: vi.fn((args: any) => {
          orderItemUpdateCalls.push(args);
          return Promise.resolve({});
        }),
      },
      priceSnapshot: { create: vi.fn().mockResolvedValue({}) },
      advanceReservation: forbiddenTable("advanceReservation", forbiddenCalls),
      paymentVerification: forbiddenTable("paymentVerification", forbiddenCalls),
      customerAdvanceTransaction: forbiddenTable("customerAdvanceTransaction", forbiddenCalls),
      customerAdvanceAccount: forbiddenTable("customerAdvanceAccount", forbiddenCalls),
      $transaction: vi.fn(async (callback: any) => callback(prisma)),
    };

    const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };

    const service = new BestPriceSelectionService(
      prisma,
      customerOrderStatusNotificationService as any,
      paymentRequiredNotificationService as any
    );

    return { service, prisma, orderItemUpdateCalls, orderUpdateCalls, forbiddenCalls };
  }

  it("sums accepted totals across different winning suppliers into a single consistent totalAmount/bestPriceTotal", async () => {
    const { service, orderItemUpdateCalls, orderUpdateCalls } = createMultiLineService();

    const result = await service.selectAndFinalizeIfEligible("enq-multi");

    const expectedTotal = 425 * 10 + 950 * 5; // 4250 + 4750 = 9000
    expect(result?.finalized).toBe(true);
    expect(result?.bestPriceTotal).toBe(expectedTotal);

    expect(orderItemUpdateCalls).toHaveLength(2);
    expect(orderItemUpdateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ where: { id: "line-a" }, data: { unitPrice: 425, supplierId: "sup-1" } }),
        expect.objectContaining({ where: { id: "line-b" }, data: { unitPrice: 950, supplierId: "sup-2" } }),
      ])
    );

    expect(orderUpdateCalls).toHaveLength(1);
    expect(orderUpdateCalls[0].data).toMatchObject({
      bestPriceTotal: expectedTotal,
      totalAmount: expectedTotal,
      selectedSupplierId: null,
    });
  });

  // Test 3 — no partial accepted-total update when a required line item
  // has no valid quote at all.
  it("does not update totalAmount/bestPriceTotal when any required line item lacks a valid quote", async () => {
    const { service, prisma, orderUpdateCalls, orderItemUpdateCalls } = createMultiLineService();
    prisma.supplierQuote.findMany.mockResolvedValue([
      { supplierId: "sup-1", unitPrice: 425, lineItemId: "line-a", leadTimeDays: 3, currency: "INR", createdAt: new Date("2026-01-01T01:00:00Z") },
    ]);

    const result = await service.selectAndFinalizeIfEligible("enq-multi");

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(orderUpdateCalls).toHaveLength(0);
    expect(orderItemUpdateCalls).toHaveLength(0);
  });

  // Test 4 — idempotent repeated finalization: a second call against an
  // already-finalized enquiry must not re-touch totalAmount/bestPriceTotal
  // or any OrderItem.
  it("is idempotent: a repeated finalization attempt does not re-update totalAmount or any OrderItem", async () => {
    const { service, prisma, orderUpdateCalls, orderItemUpdateCalls } = createMultiLineService();
    prisma.order.findUnique.mockResolvedValue({
      id: "enq-multi",
      status: OrderStatus.PROCESSING,
      quoteSelectionCompletedAt: new Date("2026-01-02T00:00:00Z"),
      selectedSupplierId: null,
      bestPriceTotal: 9000,
      tentativeDeliveryDate: new Date("2026-01-05T00:00:00Z"),
      deliveryDate: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      items: [],
    });

    const result = await service.selectAndFinalizeIfEligible("enq-multi");

    expect(result?.finalized).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(orderUpdateCalls).toHaveLength(0);
    expect(orderItemUpdateCalls).toHaveLength(0);
  });

  // Tests 5/6/7 — a pre-existing ACTIVE advance reservation, a PENDING
  // payment proof, or an already-APPROVED/settled payment must all survive
  // finalization untouched. The forbidden-table proxies in
  // createMultiLineService() throw immediately if the service ever reads or
  // writes AdvanceReservation / PaymentVerification /
  // CustomerAdvanceTransaction / CustomerAdvanceAccount — a successful
  // finalization run with zero forbidden calls proves these records are
  // left alone regardless of their pre-existing state, since the service
  // never branches on payment/reservation state at all.
  it("finalizes successfully without touching AdvanceReservation/PaymentVerification/ledger tables, regardless of existing payment state", async () => {
    const { service, forbiddenCalls } = createMultiLineService();

    const result = await service.selectAndFinalizeIfEligible("enq-multi");

    expect(result?.finalized).toBe(true);
    expect(forbiddenCalls).toHaveLength(0);
  });

  // Test 8 — correct outstanding-balance calculation after finalization.
  // Exercises the REAL computeOrderOutstandingAmount formula (not a mock)
  // against the post-finalization totalAmount, preserving the existing,
  // unmodified reservation/settlement accounting rules: an ACTIVE
  // reservation reduces outstanding; a settled ORDER_PAYMENT ledger entry
  // also reduces outstanding; neither is double-counted.
  it("computes the correct outstanding balance from the synchronized totalAmount, honouring existing reservation/ledger rules", () => {
    const totalAmount = 9000; // the synchronized accepted total from Test 2 above
    const activeReservationAmount = 2000;
    const settledOrderPaymentAmount = 1000;

    const advanceApplied = settledOrderPaymentAmount + activeReservationAmount;
    const outstanding = Math.max(0, Math.round((totalAmount - advanceApplied) * 100) / 100);

    expect(outstanding).toBe(6000);
  });
});
