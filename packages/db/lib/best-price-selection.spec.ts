import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  selectLowestValidQuote,
  finalizeEnquiryBestPriceIfEligible,
} from "./best-price-selection";

describe("selectLowestValidQuote", () => {
  it("picks the candidate with the lowest unitPrice", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "sup-high", unitPrice: 500, createdAt: new Date("2026-01-01T00:00:00Z") },
      { supplierId: "sup-low", unitPrice: 420, createdAt: new Date("2026-01-01T00:00:00Z") },
      { supplierId: "sup-mid", unitPrice: 480, createdAt: new Date("2026-01-01T00:00:00Z") },
    ]);
    expect(winner.supplierId).toBe("sup-low");
    expect(winner.unitPrice).toBe(420);
  });

  it("breaks ties by lead time, then createdAt, then supplierId", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "sup-b", unitPrice: 400, leadTimeDays: 5, createdAt: new Date("2026-01-01T00:00:00Z") },
      { supplierId: "sup-a", unitPrice: 400, leadTimeDays: 3, createdAt: new Date("2026-01-01T00:00:00Z") },
    ]);
    expect(winner.supplierId).toBe("sup-a");
  });

  it("throws when candidate array is empty", () => {
    expect(() => selectLowestValidQuote([])).toThrow(/No candidates/);
  });
});

describe("finalizeEnquiryBestPriceIfEligible", () => {
  let mockPrisma: any;
  let orderData: any;
  let quoteData: any[];
  let updatedOrders: any[];
  let updatedOrderItems: any[];
  let updatedQuotes: any[];
  let createdTracking: any[];
  let scheduledTasks: Promise<any>[];

  beforeEach(() => {
    updatedOrders = [];
    updatedOrderItems = [];
    updatedQuotes = [];
    createdTracking = [];
    scheduledTasks = [];

    orderData = {
      id: "enq-1",
      enquiryId: "BH-2026-0001",
      orderNumber: null,
      status: "PLACED",
      quoteSelectionCompletedAt: null,
      totalAmount: 10000,
      deliveryDate: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date(),
      items: [
        {
          id: "item-1",
          productId: "prod-1",
          supplierId: "sup-1",
          quantity: 10,
          unitPrice: 1000,
          product: { id: "prod-1", name: "Steel 12mm", categoryId: "cat-1", canonicalProductId: null },
        },
      ],
    };

    quoteData = [
      {
        id: "quote-1",
        enquiryId: "enq-1",
        supplierId: "sup-1",
        lineItemId: "item-1",
        unitPrice: 900,
        currency: "INR",
        leadTimeDays: 2,
        createdAt: new Date(),
      },
    ];

    mockPrisma = {
      order: {
        findUnique: vi.fn(async () => orderData),
      },
      supplierQuote: {
        findMany: vi.fn(async () => quoteData),
      },
      supplierProfile: {
        findUnique: vi.fn(async () => ({ id: "sup-1", companyName: "Acme Steel", region: "South" })),
        findMany: vi.fn(async () => [{ id: "sup-1", region: "South" }]),
      },
      priceSnapshot: {
        create: vi.fn(async () => ({})),
      },
      orderTracking: {
        create: vi.fn(async ({ data }: any) => {
          createdTracking.push(data);
          return { id: "track-1", ...data };
        }),
      },
      productMarkupSetting: {
        findUnique: vi.fn(async () => null),
      },
      categoryMarkupSetting: {
        findUnique: vi.fn(async () => null),
      },
      globalMarkupSetting: {
        findUnique: vi.fn(async () => null),
      },
      taxSetting: {
        findMany: vi.fn(async () => [
          {
            scope: "GLOBAL",
            scopeId: null,
            percentage: 18,
            isEnabled: true,
          },
        ]),
      },
      advanceConfig: {
        findUnique: vi.fn(async () => ({ percentage: 20, isEnabled: true })),
      },
      businessSequence: {
        findUnique: vi.fn(async () => ({ sequenceNumber: 1 })),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({ sequenceNumber: 2 })),
        upsert: vi.fn(async () => ({})),
      },
      $queryRaw: vi.fn(async () => [{ sequenceNumber: 1 }]),
      $transaction: vi.fn(async (cb: any) => {
        const tx = {
          order: {
            updateMany: vi.fn(async ({ data }: any) => {
              updatedOrders.push(data);
              Object.assign(orderData, data);
              return { count: 1 };
            }),
            findUnique: vi.fn(async () => orderData),
            update: vi.fn(async ({ data }: any) => {
              Object.assign(orderData, data);
              return orderData;
            }),
          },
          orderItem: {
            update: vi.fn(async ({ where, data }: any) => {
              updatedOrderItems.push({ where, data });
              return {};
            }),
          },
          supplierQuote: {
            updateMany: vi.fn(async ({ where, data }: any) => {
              updatedQuotes.push({ where, data });
              return { count: 1 };
            }),
          },
          $queryRaw: vi.fn(async () => [{ sequenceNumber: 1 }]),
          businessSequence: {
            findUnique: vi.fn(async () => ({ sequenceNumber: 1 })),
            create: vi.fn(async () => ({})),
            update: vi.fn(async () => ({ sequenceNumber: 2 })),
            upsert: vi.fn(async () => ({})),
          },
        };
        return cb(tx);
      }),
    };
  });

  it("finalizes enquiry when quotes are eligible, sets status to PROCESSING and generates orderNumber", async () => {
    const result = await finalizeEnquiryBestPriceIfEligible(mockPrisma, "enq-1", {
      waitUntil: (p) => {
        scheduledTasks.push(p);
      },
    });

    expect(result).not.toBeNull();
    expect(result?.finalized).toBe(true);
    expect(result?.selectedSupplierId).toBe("sup-1");
    expect(result?.bestPriceTotal).toBe(9000); // 10 * 900 (0% default markup)

    // Order status transitioned to PROCESSING
    expect(orderData.status).toBe("PROCESSING");
    expect(orderData.quoteSelectionCompletedAt).not.toBeNull();
    expect(orderData.totalAmount).toBe(9000);
    expect(orderData.orderNumber).toBeDefined();

    // Financial snapshot populated
    expect(orderData.taxAmount).toBeDefined();
    expect(orderData.finalPayableAmount).toBeDefined();

    // Line items updated
    expect(updatedOrderItems).toHaveLength(1);
    expect(updatedOrderItems[0].data.unitPrice).toBe(900);
    expect(updatedOrderItems[0].data.taxRatePercent).toBe(18);

    // Tracking entry recorded
    expect(createdTracking).toHaveLength(1);
    expect(createdTracking[0]).toMatchObject({
      orderId: "enq-1",
      status: "PROCESSING",
      note: "Supplier marked order as Processing",
    });

    // Scheduled notifications triggered
    expect(scheduledTasks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns finalized: false without re-running if enquiry is already finalized", async () => {
    orderData.quoteSelectionCompletedAt = new Date("2026-01-01T00:00:00Z");
    orderData.taxAmount = 1800;
    orderData.finalPayableAmount = 11800; // 10000 + 1800
    orderData.advancePercent = 20;
    orderData.requiredAdvanceAmount = 2360;
    orderData.items[0].taxRatePercent = 18;
    orderData.items[0].taxAmount = 1800;

    const result = await finalizeEnquiryBestPriceIfEligible(mockPrisma, "enq-1");

    expect(result?.finalized).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(createdTracking).toHaveLength(0);
  });

  it("does not finalize when minQuotes is not met and deadline has not passed", async () => {
    const result = await finalizeEnquiryBestPriceIfEligible(mockPrisma, "enq-1", {
      minQuotes: 2,
      deadlineMinutes: 60,
    });

    expect(result).toBeNull();
    expect(orderData.status).toBe("PLACED");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
