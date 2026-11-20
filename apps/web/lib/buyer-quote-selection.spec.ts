import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOrder, mockQuotes, mockTxUpdates } = vi.hoisted(() => ({
  mockOrder: { current: null as any },
  mockQuotes: { current: [] as any[] },
  mockTxUpdates: { orderItem: [] as any[], order: [] as any[], tracking: [] as any[] },
}));

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: {
      findFirst: vi.fn(async () => mockOrder.current),
      update: vi.fn(async (args) => {
        mockTxUpdates.order.push(args);
        return { ...mockOrder.current, ...args.data };
      }),
    },
    supplierQuote: {
      findFirst: vi.fn(async (args) => {
        return mockQuotes.current.find((q) => q.id === args.where.id) || null;
      }),
    },
    orderItem: {
      update: vi.fn(async (args) => {
        mockTxUpdates.orderItem.push(args);
        return {};
      }),
      findMany: vi.fn(async () => [
        { unitPrice: 110, quantity: 10, taxAmount: 198 },
      ]),
    },
    orderTracking: {
      create: vi.fn(async (args) => {
        mockTxUpdates.tracking.push(args);
        return {};
      }),
    },
    customerAdvanceTransaction: {
      findFirst: vi.fn(async () => null),
    },
    purchaseOrder: {
      count: vi.fn(async () => mockOrder.current?.purchaseOrders?.length ?? 0),
    },
    $transaction: vi.fn(async (callback) => {
      return callback({
        orderItem: {
          update: vi.fn(async (args) => {
            mockTxUpdates.orderItem.push(args);
            return {};
          }),
          findMany: vi.fn(async () => [
            { unitPrice: 110, quantity: 10, taxAmount: 198 },
          ]),
        },
        order: {
          update: vi.fn(async (args) => {
            mockTxUpdates.order.push(args);
            return {};
          }),
        },
        orderTracking: {
          create: vi.fn(async (args) => {
            mockTxUpdates.tracking.push(args);
            return {};
          }),
        },
      });
    }),
  },
  getOrCreateBuilder: vi.fn(async () => ({ id: "builder-1", name: "Builder" })),
  getUserCtx: vi.fn(() => ({ userId: "builder-1", email: "builder@example.com", name: "Builder" })),
}));

import { GET } from "../app/api/builder/orders/[id]/quotes/route";
import { POST } from "../app/api/builder/orders/[id]/select-quote/route";

describe("Buyer Quotations API", () => {
  beforeEach(() => {
    mockTxUpdates.orderItem.length = 0;
    mockTxUpdates.order.length = 0;
    mockTxUpdates.tracking.length = 0;
  });

  describe("GET /api/builder/orders/[id]/quotes", () => {
    it("returns only quotes with status SENT_TO_BUYER and displays lock status", async () => {
      mockOrder.current = {
        id: "order-1",
        enquiryId: "EQ-001",
        status: "PLACED",
        paymentStatus: "PENDING",
        selectedSupplierId: null,
        selectedQuoteId: null,
        quoteSelectionCompletedAt: null,
        purchaseOrders: [],
        supplierQuotes: [
          {
            id: "q-1",
            supplierId: "sup-1",
            supplier: { id: "sup-1", companyName: "Supplier A" },
            lineItemId: "item-1",
            lineItem: { quantity: 10, product: { id: "p-1", name: "Cement", unit: "BAG" } },
            unitPrice: 350,
            buyerUnitPrice: 385,
            currency: "INR",
            leadTimeDays: 2,
            lineSubtotal: 3850,
            gstRatePercent: 18,
            gstAmount: 693,
            lineTotal: 4543,
            sentToBuyerAt: new Date("2026-11-20T10:00:00Z"),
          },
        ],
      };

      const res = await GET(new Request("http://localhost/api/builder/orders/order-1/quotes"), {
        params: { id: "order-1" },
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.isLocked).toBe(false);
      expect(data.quotes).toHaveLength(1);
      expect(data.quotes[0]).toMatchObject({
        id: "q-1",
        buyerUnitPrice: 385,
        lineTotal: 4543,
        isSelected: false,
      });
    });

    it("indicates isLocked: true when order is paid", async () => {
      mockOrder.current = {
        id: "order-1",
        status: "PROCESSING",
        paymentStatus: "PAID",
        purchaseOrders: [],
        supplierQuotes: [],
      };

      const res = await GET(new Request("http://localhost/api/builder/orders/order-1/quotes"), {
        params: { id: "order-1" },
      });
      const data = await res.json();

      expect(data.isLocked).toBe(true);
      expect(data.lockReason).toContain("Payment has already been completed");
    });
  });

  describe("POST /api/builder/orders/[id]/select-quote", () => {
    it("rejects selection when paymentStatus is PAID", async () => {
      mockOrder.current = {
        id: "order-1",
        paymentStatus: "PAID",
        purchaseOrders: [],
      };

      const res = await POST(
        new Request("http://localhost/api/builder/orders/order-1/select-quote", {
          method: "POST",
          body: JSON.stringify({ quoteId: "q-1" }),
        }),
        { params: { id: "order-1" } }
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("Payment has already been completed");
    });

    it("rejects selection when a Purchase Order exists", async () => {
      mockOrder.current = {
        id: "order-1",
        paymentStatus: "PENDING",
        purchaseOrders: [{ id: "po-1" }],
      };

      const res = await POST(
        new Request("http://localhost/api/builder/orders/order-1/select-quote", {
          method: "POST",
          body: JSON.stringify({ quoteId: "q-1" }),
        }),
        { params: { id: "order-1" } }
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("A Purchase Order has already been generated");
    });

    it("atomically selects quote and updates OrderItem and Order commercial totals", async () => {
      mockOrder.current = {
        id: "order-1",
        status: "PLACED",
        paymentStatus: "PENDING",
        selectedSupplierId: null,
        purchaseOrders: [],
      };

      mockQuotes.current = [
        {
          id: "q-1",
          enquiryId: "order-1",
          supplierId: "sup-1",
          supplier: { id: "sup-1", companyName: "Supplier A" },
          lineItemId: "item-1",
          lineItem: { quantity: 10, product: { name: "Cement" } },
          unitPrice: 100, // raw supplier rate
          buyerUnitPrice: 110, // marked-up buyer rate
          markupPercent: 10,
          markupAmount: 10,
          gstRatePercent: 18,
          quantity: 10,
        },
      ];

      const res = await POST(
        new Request("http://localhost/api/builder/orders/order-1/select-quote", {
          method: "POST",
          body: JSON.stringify({ quoteId: "q-1" }),
        }),
        { params: { id: "order-1" } }
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.selectedSupplierId).toBe("sup-1");

      // Verify OrderItem updated with buyer rate and preserved original supplier rate
      expect(mockTxUpdates.orderItem).toHaveLength(1);
      expect(mockTxUpdates.orderItem[0]).toMatchObject({
        where: { id: "item-1" },
        data: expect.objectContaining({
          supplierId: "sup-1",
          unitPrice: 110,
          supplierUnitPrice: 100,
          markupPercent: 10,
          markupAmount: 10,
        }),
      });

      // Verify Order updated
      expect(mockTxUpdates.order).toHaveLength(1);
      expect(mockTxUpdates.order[0]).toMatchObject({
        where: { id: "order-1" },
        data: expect.objectContaining({
          selectedSupplierId: "sup-1",
          selectedQuoteId: "q-1",
          status: "PROCESSING",
        }),
      });
    });
  });
});
