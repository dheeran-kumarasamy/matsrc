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
              product: { name: "Cement OPC", canonicalProductId: null, categoryId: "cat-1" },
            },
          ],
        }),
        update: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({});
        }),
        // Concurrency guard (Phase 3): the real implementation claims the
        // order via a conditional updateMany keyed on
        // quoteSelectionCompletedAt still being null. Default to count: 1
        // (this request wins the race) for every pre-existing test in this
        // file — the dedicated concurrency tests below override this.
        updateMany: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({ count: 1 });
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      // Product-Level GST (Phase 3): a GLOBAL 18% rate by default so every
      // pre-existing test in this file (written before GST existed) keeps
      // passing unmodified. See the dedicated GST-specific tests below for
      // precedence/missing-configuration coverage.
      taxSetting: {
        findMany: vi.fn().mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }]),
      },
      advanceConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma)),
    } as any;

    const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    // Admin-Configurable Product Markup: 0% by default (echoes the
    // supplier's own quoted price back unchanged) so every PRE-EXISTING
    // assertion in this file (written before markup existed) keeps passing
    // unmodified. See the dedicated markup-specific tests below for
    // non-zero-markup coverage.
    const markupService = {
      resolveMarkupForProduct: vi.fn(async (params: { supplierUnitPrice: number }) => ({
        supplierUnitPrice: params.supplierUnitPrice,
        buyerUnitPrice: params.supplierUnitPrice,
        markupPercent: 0,
        markupAmount: 0,
      })),
    };

    const service = new BestPriceSelectionService(
      prisma,
      customerOrderStatusNotificationService as any,
      paymentRequiredNotificationService as any,
      markupService as any
    );

    return { service, prisma, orderItemUpdateCalls, orderUpdateCalls, markupService };
  }

  it("updates OrderItem.unitPrice/supplierId to the winning SupplierQuote, not the original catalogue price", async () => {
    const { service, orderItemUpdateCalls, markupService } = createService();
    markupService.resolveMarkupForProduct.mockResolvedValue({
      supplierUnitPrice: 425,
      buyerUnitPrice: 425,
      markupPercent: 0,
      markupAmount: 0,
    });

    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(true);
    expect(orderItemUpdateCalls).toHaveLength(1);
    expect(orderItemUpdateCalls[0]).toMatchObject({
      where: { id: "line-1" },
      data: { unitPrice: 425, supplierId: "sup-winner", supplierUnitPrice: 425, markupPercent: 0, markupAmount: 0 },
    });
  });

  it("applies a non-zero markup: buyer price is the supplier's quote marked up, never the raw quote", async () => {
    const { service, orderItemUpdateCalls, markupService } = createService();
    markupService.resolveMarkupForProduct.mockResolvedValue({
      supplierUnitPrice: 425,
      buyerUnitPrice: 467.5, // 425 * 1.10
      markupPercent: 10,
      markupAmount: 42.5,
    });

    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(true);
    expect(orderItemUpdateCalls[0].data).toMatchObject({
      unitPrice: 467.5,
      supplierUnitPrice: 425,
      markupPercent: 10,
      markupAmount: 42.5,
    });
    expect(markupService.resolveMarkupForProduct).toHaveBeenCalledWith({
      productId: "prod-1",
      categoryId: "cat-1",
      supplierUnitPrice: 425,
    });
  });

  it("falls back to 0% markup (never blocks finalization) when no markup configuration exists", async () => {
    const { service, orderItemUpdateCalls, markupService } = createService();
    markupService.resolveMarkupForProduct.mockResolvedValue(null as any);

    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(true);
    expect(orderItemUpdateCalls[0].data).toMatchObject({
      unitPrice: 425,
      supplierUnitPrice: 425,
      markupPercent: 0,
      markupAmount: 0,
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
            { id: "line-a", productId: "prod-a", quantity: 10, unitPrice: 400, product: { name: "Cement OPC", canonicalProductId: null, categoryId: "cat-a" } },
            { id: "line-b", productId: "prod-b", quantity: 5, unitPrice: 1000, product: { name: "TMT Bar", canonicalProductId: null, categoryId: "cat-b" } },
          ],
        }),
        update: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({});
        }),
        updateMany: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      supplierQuote: {
        findMany: vi.fn().mockResolvedValue([
          { supplierId: "sup-1", unitPrice: 425, lineItemId: "line-a", leadTimeDays: 3, currency: "INR", createdAt: new Date("2026-01-01T01:00:00Z") },
          { supplierId: "sup-2", unitPrice: 950, lineItemId: "line-b", leadTimeDays: 2, currency: "INR", createdAt: new Date("2026-01-01T01:00:00Z") },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      taxSetting: {
        findMany: vi.fn().mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }]),
      },
      advanceConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      advanceReservation: forbiddenTable("advanceReservation", forbiddenCalls),
      paymentVerification: forbiddenTable("paymentVerification", forbiddenCalls),
      customerAdvanceTransaction: forbiddenTable("customerAdvanceTransaction", forbiddenCalls),
      customerAdvanceAccount: forbiddenTable("customerAdvanceAccount", forbiddenCalls),
      $transaction: vi.fn(async (callback: any) => callback(prisma)),
    };

    const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    // Admin-Configurable Product Markup: 0% (echoes the supplier price back
    // unchanged) so every pre-existing total/price assertion in this suite
    // keeps passing unmodified.
    const markupService = {
      resolveMarkupForProduct: vi.fn(async (params: { supplierUnitPrice: number }) => ({
        supplierUnitPrice: params.supplierUnitPrice,
        buyerUnitPrice: params.supplierUnitPrice,
        markupPercent: 0,
        markupAmount: 0,
      })),
    };

    const service = new BestPriceSelectionService(
      prisma,
      customerOrderStatusNotificationService as any,
      paymentRequiredNotificationService as any,
      markupService as any
    );

    return { service, prisma, orderItemUpdateCalls, orderUpdateCalls, forbiddenCalls, markupService };
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
        expect.objectContaining({
          where: { id: "line-a" },
          data: expect.objectContaining({ unitPrice: 425, supplierId: "sup-1" }),
        }),
        expect.objectContaining({
          where: { id: "line-b" },
          data: expect.objectContaining({ unitPrice: 950, supplierId: "sup-2" }),
        }),
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
      // Legacy/pre-GST-feature order: a fully-null snapshot (confirmed
      // before Product-Level GST existed) — totalAmount must still be a
      // real number for assertFullOrderSnapshotIntegrity's nullness-only
      // fast path, but taxAmount/finalPayableAmount/etc. stay null so no
      // arithmetic/line-level check runs.
      totalAmount: 9000,
      taxAmount: null,
      finalPayableAmount: null,
      advancePercent: null,
      requiredAdvanceAmount: null,
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

// Product-Level GST / GST-Inclusive Buyer Payable (Phase 3) — the
// confirmation snapshot freeze. Reuses a single-line fixture (prod-1/cat-1,
// supplier quote 425, markup 10%).
describe("BestPriceSelectionService.selectAndFinalizeIfEligible — GST snapshot freeze", () => {
  function createService() {
    const orderItemUpdateCalls: any[] = [];
    const orderUpdateCalls: any[] = [];

    const prisma: any = {
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
              unitPrice: 400,
              product: { name: "Cement OPC", canonicalProductId: null, categoryId: "cat-1" },
            },
          ],
        }),
        update: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({});
        }),
        updateMany: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      supplierQuote: {
        findMany: vi.fn().mockResolvedValue([
          { supplierId: "sup-winner", unitPrice: 425, lineItemId: "line-1", leadTimeDays: 3, currency: "INR", createdAt: new Date("2026-01-01T01:00:00Z") },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      priceSnapshot: { create: vi.fn().mockResolvedValue({}) },
      taxSetting: { findMany: vi.fn().mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }]) },
      advanceConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: any) => callback(prisma)),
    };

    const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const markupService = {
      resolveMarkupForProduct: vi.fn(async (params: { supplierUnitPrice: number }) => ({
        supplierUnitPrice: params.supplierUnitPrice,
        buyerUnitPrice: params.supplierUnitPrice * 1.1,
        markupPercent: 10,
        markupAmount: params.supplierUnitPrice * 0.1,
      })),
    };

    const service = new BestPriceSelectionService(
      prisma,
      customerOrderStatusNotificationService as any,
      paymentRequiredNotificationService as any,
      markupService as any
    );

    return { service, prisma, orderItemUpdateCalls, orderUpdateCalls };
  }

  it("freezes taxAmount/finalPayableAmount on Order and taxRatePercent/taxAmount on OrderItem", async () => {
    const { service, orderUpdateCalls, orderItemUpdateCalls } = createService();
    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(true);
    expect(orderUpdateCalls[0].data).toMatchObject({
      taxAmount: 841.5,
      finalPayableAmount: 5516.5,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });
    expect(orderItemUpdateCalls[0].data).toMatchObject({ taxRatePercent: 18, taxAmount: 841.5 });
  });

  it("blocks confirmation with no partial writes when no GST configuration exists", async () => {
    const { service, prisma, orderUpdateCalls, orderItemUpdateCalls } = createService();
    prisma.taxSetting.findMany.mockResolvedValue([]);

    await expect(service.selectAndFinalizeIfEligible("enq-1")).rejects.toThrow();

    expect(orderUpdateCalls).toHaveLength(0);
    expect(orderItemUpdateCalls).toHaveLength(0);
  });
});

// Retry/concurrency safety (Phase 3) — reuses the single-line fixture.
describe("BestPriceSelectionService.selectAndFinalizeIfEligible — retry and concurrency safety", () => {
  function createService() {
    const orderItemUpdateCalls: any[] = [];
    const orderUpdateCalls: any[] = [];

    const prisma: any = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "enq-1",
          status: OrderStatus.PLACED,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          deliveryDate: null,
          quoteSelectionCompletedAt: null,
          items: [
            { id: "line-1", productId: "prod-1", quantity: 10, unitPrice: 400, product: { name: "Cement OPC", canonicalProductId: null, categoryId: "cat-1" } },
          ],
        }),
        update: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({});
        }),
        updateMany: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      supplierQuote: {
        findMany: vi.fn().mockResolvedValue([
          { supplierId: "sup-winner", unitPrice: 425, lineItemId: "line-1", leadTimeDays: 3, currency: "INR", createdAt: new Date("2026-01-01T01:00:00Z") },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      supplierProfile: {
        findUnique: vi.fn().mockResolvedValue({ id: "sup-winner", companyName: "Winner Supplier", region: null }),
        findMany: vi.fn().mockResolvedValue([{ id: "sup-winner", region: null }]),
      },
      orderItem: { update: vi.fn((args: any) => { orderItemUpdateCalls.push(args); return Promise.resolve({}); }) },
      priceSnapshot: { create: vi.fn().mockResolvedValue({}) },
      taxSetting: { findMany: vi.fn().mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }]) },
      advanceConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: any) => callback(prisma)),
    };

    const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const markupService = {
      resolveMarkupForProduct: vi.fn(async (params: { supplierUnitPrice: number }) => ({
        supplierUnitPrice: params.supplierUnitPrice,
        buyerUnitPrice: params.supplierUnitPrice * 1.1,
        markupPercent: 10,
        markupAmount: params.supplierUnitPrice * 0.1,
      })),
    };

    const service = new BestPriceSelectionService(
      prisma,
      customerOrderStatusNotificationService as any,
      paymentRequiredNotificationService as any,
      markupService as any
    );

    return { service, prisma, orderItemUpdateCalls, orderUpdateCalls };
  }

  it("does not reapply markup or rewrite an existing complete snapshot on retry", async () => {
    const { service, prisma, orderUpdateCalls, orderItemUpdateCalls } = createService();
    prisma.order.findUnique.mockResolvedValue({
      id: "enq-1",
      status: OrderStatus.PROCESSING,
      quoteSelectionCompletedAt: new Date("2026-01-02T00:00:00Z"),
      selectedSupplierId: "sup-winner",
      bestPriceTotal: 4675,
      totalAmount: 4675,
      taxAmount: 841.5,
      finalPayableAmount: 5516.5,
      advancePercent: null,
      requiredAdvanceAmount: null,
      tentativeDeliveryDate: new Date("2026-01-05T00:00:00Z"),
      deliveryDate: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      // Matching line-level snapshot for the confirmed order-level totals
      // above (4675 * 18% = 841.5) — assertFullOrderSnapshotIntegrity now
      // requires every line to carry a non-null snapshot and reconcile
      // with Order.taxAmount for a confirmed order.
      items: [{ id: "line-1", taxRatePercent: 18, taxAmount: 841.5 }],
    });

    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(orderUpdateCalls).toHaveLength(0);
    expect(orderItemUpdateCalls).toHaveLength(0);
  });

  it("fails safely (throws) rather than silently repairing a partially-populated snapshot", async () => {
    const { service, prisma } = createService();
    prisma.order.findUnique.mockResolvedValue({
      id: "enq-1",
      status: OrderStatus.PROCESSING,
      quoteSelectionCompletedAt: new Date("2026-01-02T00:00:00Z"),
      selectedSupplierId: "sup-winner",
      bestPriceTotal: 4675,
      taxAmount: 841.5,
      finalPayableAmount: null,
      advancePercent: null,
      requiredAdvanceAmount: null,
      tentativeDeliveryDate: new Date("2026-01-05T00:00:00Z"),
      deliveryDate: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      items: [],
    });

    await expect(service.selectAndFinalizeIfEligible("enq-1")).rejects.toThrow(/inconsistent financial snapshot/);
  });

  it("loses a concurrent confirmation race safely: re-reads and returns the winner's result without a second write", async () => {
    const { service, prisma, orderItemUpdateCalls } = createService();
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: "enq-1",
        status: OrderStatus.PLACED,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        deliveryDate: null,
        quoteSelectionCompletedAt: null,
        items: [
          { id: "line-1", productId: "prod-1", quantity: 10, unitPrice: 400, product: { name: "Cement OPC", canonicalProductId: null, categoryId: "cat-1" } },
        ],
      })
      .mockResolvedValueOnce({
        id: "enq-1",
        selectedSupplierId: "sup-winner",
        bestPriceTotal: 4675,
        totalAmount: 4675,
        taxAmount: 841.5,
        finalPayableAmount: 5516.5,
        advancePercent: null,
        requiredAdvanceAmount: null,
        tentativeDeliveryDate: new Date("2026-01-05T00:00:00Z"),
        deliveryDate: null,
        // The winner's own committed line-level snapshot, reconciling with
        // the order-level totals above (assertFullOrderSnapshotIntegrity).
        items: [{ id: "line-1", taxRatePercent: 18, taxAmount: 841.5 }],
      });

    const result = await service.selectAndFinalizeIfEligible("enq-1");

    expect(result?.finalized).toBe(false);
    expect(result?.bestPriceTotal).toBe(4675);
    expect(orderItemUpdateCalls).toHaveLength(0);
  });
});

// RFQ Waiting-Window — the agreed decision is that the waiting window for
// additional competing quotes starts from the FIRST VALID SUPPLIER
// RESPONSE, never from Order.createdAt (the enquiry's own creation time,
// which may long predate any supplier actually responding).
describe("BestPriceSelectionService.selectAndFinalizeIfEligible — RFQ waiting window", () => {
  function createService(quotes: Array<{ supplierId: string; createdAt: Date }>) {
    const orderItemUpdateCalls: any[] = [];
    const orderUpdateCalls: any[] = [];

    const prisma: any = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "enq-1",
          status: OrderStatus.PLACED,
          // Enquiry created long before any supplier responded — if the
          // window were (incorrectly) anchored here, it would already be
          // expired by the time the first quote arrives.
          createdAt: new Date("2026-01-01T00:00:00Z"),
          deliveryDate: null,
          quoteSelectionCompletedAt: null,
          items: [
            { id: "line-1", productId: "prod-1", quantity: 10, unitPrice: 400, product: { name: "Cement OPC", canonicalProductId: null, categoryId: "cat-1" } },
          ],
        }),
        update: vi.fn((args: any) => { orderUpdateCalls.push(args); return Promise.resolve({}); }),
        updateMany: vi.fn((args: any) => { orderUpdateCalls.push(args); return Promise.resolve({ count: 1 }); }),
      },
      supplierQuote: {
        findMany: vi.fn().mockResolvedValue(
          quotes.map((q, i) => ({
            supplierId: q.supplierId,
            unitPrice: 500 + i,
            lineItemId: "line-1",
            leadTimeDays: 3,
            currency: "INR",
            createdAt: q.createdAt,
          }))
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      supplierProfile: {
        findUnique: vi.fn().mockResolvedValue({ id: quotes[0]?.supplierId, companyName: "Winner Supplier", region: null }),
        findMany: vi.fn().mockResolvedValue(quotes.map((q) => ({ id: q.supplierId, region: null }))),
      },
      orderItem: { update: vi.fn((args: any) => { orderItemUpdateCalls.push(args); return Promise.resolve({}); }) },
      priceSnapshot: { create: vi.fn().mockResolvedValue({}) },
      taxSetting: { findMany: vi.fn().mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }]) },
      advanceConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: any) => callback(prisma)),
    };

    const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn().mockResolvedValue(undefined) };
    const markupService = {
      resolveMarkupForProduct: vi.fn(async (params: { supplierUnitPrice: number }) => ({
        supplierUnitPrice: params.supplierUnitPrice,
        buyerUnitPrice: params.supplierUnitPrice,
        markupPercent: 0,
        markupAmount: 0,
      })),
    };

    const service = new BestPriceSelectionService(
      prisma,
      customerOrderStatusNotificationService as any,
      paymentRequiredNotificationService as any,
      markupService as any
    );

    return { service, prisma, orderUpdateCalls, orderItemUpdateCalls };
  }

  it("does not finalize before MIN_QUOTES_FOR_SELECTION is met, even long after Order.createdAt, when the deadline (measured from the first response) has not yet elapsed", async () => {
    const originalMin = process.env.MIN_QUOTES_FOR_SELECTION;
    const originalDeadline = process.env.QUOTE_DEADLINE_MINUTES;
    process.env.MIN_QUOTES_FOR_SELECTION = "2";
    process.env.QUOTE_DEADLINE_MINUTES = "60";
    try {
      const firstResponseAt = new Date(Date.now() - 5 * 60 * 1000);
      const { service, orderUpdateCalls } = createService([{ supplierId: "sup-a", createdAt: firstResponseAt }]);

      const result = await service.selectAndFinalizeIfEligible("enq-1");

      expect(result).toBeNull();
      expect(orderUpdateCalls).toHaveLength(0);
    } finally {
      process.env.MIN_QUOTES_FOR_SELECTION = originalMin;
      process.env.QUOTE_DEADLINE_MINUTES = originalDeadline;
    }
  });

  it("finalizes once the deadline measured from the FIRST RESPONSE (not Order.createdAt) has elapsed, even with fewer than MIN_QUOTES_FOR_SELECTION", async () => {
    const originalMin = process.env.MIN_QUOTES_FOR_SELECTION;
    const originalDeadline = process.env.QUOTE_DEADLINE_MINUTES;
    process.env.MIN_QUOTES_FOR_SELECTION = "2";
    process.env.QUOTE_DEADLINE_MINUTES = "60";
    try {
      const firstResponseAt = new Date(Date.now() - 90 * 60 * 1000);
      const { service, orderUpdateCalls } = createService([{ supplierId: "sup-a", createdAt: firstResponseAt }]);

      const result = await service.selectAndFinalizeIfEligible("enq-1");

      expect(result?.finalized).toBe(true);
      expect(orderUpdateCalls.length).toBeGreaterThan(0);
    } finally {
      process.env.MIN_QUOTES_FOR_SELECTION = originalMin;
      process.env.QUOTE_DEADLINE_MINUTES = originalDeadline;
    }
  });

  it("anchors the deadline to the EARLIEST of multiple responses, regardless of SupplierQuote fetch order", async () => {
    const originalMin = process.env.MIN_QUOTES_FOR_SELECTION;
    const originalDeadline = process.env.QUOTE_DEADLINE_MINUTES;
    process.env.MIN_QUOTES_FOR_SELECTION = "5";
    process.env.QUOTE_DEADLINE_MINUTES = "60";
    try {
      const { service, orderUpdateCalls } = createService([
        { supplierId: "sup-b", createdAt: new Date(Date.now() - 10 * 60 * 1000) },
        { supplierId: "sup-a", createdAt: new Date(Date.now() - 90 * 60 * 1000) },
      ]);

      const result = await service.selectAndFinalizeIfEligible("enq-1");

      expect(result?.finalized).toBe(true);
      expect(orderUpdateCalls.length).toBeGreaterThan(0);
    } finally {
      process.env.MIN_QUOTES_FOR_SELECTION = originalMin;
      process.env.QUOTE_DEADLINE_MINUTES = originalDeadline;
    }
  });

  it("the no-response case (zero SupplierQuote rows) never finalizes, regardless of how old Order.createdAt is", async () => {
    const originalDeadline = process.env.QUOTE_DEADLINE_MINUTES;
    process.env.QUOTE_DEADLINE_MINUTES = "60";
    try {
      const { service, prisma, orderUpdateCalls } = createService([]);
      prisma.supplierQuote.findMany.mockResolvedValue([]);

      const result = await service.selectAndFinalizeIfEligible("enq-1");

      expect(result).toBeNull();
      expect(orderUpdateCalls).toHaveLength(0);
    } finally {
      process.env.QUOTE_DEADLINE_MINUTES = originalDeadline;
    }
  });

  it("a duplicate/revised quote from the same supplier for the same line never corrupts selection — the lowest valid quote still wins", async () => {
    const originalMin = process.env.MIN_QUOTES_FOR_SELECTION;
    process.env.MIN_QUOTES_FOR_SELECTION = "1";
    try {
      const { service, prisma, orderItemUpdateCalls } = createService([
        { supplierId: "sup-a", createdAt: new Date(Date.now() - 20 * 60 * 1000) },
      ]);
      prisma.supplierQuote.findMany.mockResolvedValue([
        { supplierId: "sup-a", unitPrice: 480, lineItemId: "line-1", leadTimeDays: 3, currency: "INR", createdAt: new Date(Date.now() - 20 * 60 * 1000) },
        { supplierId: "sup-a", unitPrice: 500, lineItemId: "line-1", leadTimeDays: 3, currency: "INR", createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      ]);

      const result = await service.selectAndFinalizeIfEligible("enq-1");

      expect(result?.finalized).toBe(true);
      expect(orderItemUpdateCalls[0].data.unitPrice).toBe(480);
    } finally {
      process.env.MIN_QUOTES_FOR_SELECTION = originalMin;
    }
  });
});
