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
});
