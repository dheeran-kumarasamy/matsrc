// Admin-Configurable Product Markup — Finding 2 regression coverage.
//
// declineOrderForSupplier() (private, reached via
// updateSupplierOrderStatus(orderId, "CANCELLED", supplierId)) promotes the
// next-ranked OrderItemSupplierCandidate when the currently-assigned
// supplier declines. The candidate's own `unitPrice` is the ORIGINAL,
// never-marked-up supplier price captured at checkout time (see
// apps/web/lib/order-checkout.ts's candidates: { create: ... unitPrice:
// candidate.unitPrice }) — promoting it onto the BUYER-facing
// OrderItem.unitPrice must re-apply markup, and Order.totalAmount must be
// resynced from the full, current set of order lines.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  orderRows,
  orderItemUpdateCalls,
  orderUpdateCalls,
  orderItemFindManyMock,
  markupByProductId,
  waitUntilMock,
} = vi.hoisted(() => ({
  orderRows: new Map<string, any>(),
  orderItemUpdateCalls: [] as any[],
  orderUpdateCalls: [] as any[],
  orderItemFindManyMock: vi.fn(),
  markupByProductId: new Map<string, any>(),
  waitUntilMock: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: waitUntilMock }));

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      order: {
        findUnique: vi.fn((args: any) => Promise.resolve(orderRows.get(args.where.id) ?? null)),
        update: vi.fn((args: any) => {
          orderUpdateCalls.push(args);
          return Promise.resolve({});
        }),
      },
      orderItemSupplierCandidate: {
        update: vi.fn(() => Promise.resolve({})),
      },
      orderItem: {
        update: vi.fn((args: any) => {
          orderItemUpdateCalls.push(args);
          return Promise.resolve({});
        }),
        findMany: orderItemFindManyMock,
      },
      orderTracking: { create: vi.fn(() => Promise.resolve({})) },
      customerAdvanceAccount: { findFirst: vi.fn(() => Promise.resolve(null)) },
      // Consumed by the best-effort notifySupplierOrderSubmittedForCandidate
      // notification fired after promotion — failures there are already
      // caught internally (non-fatal) and are irrelevant to the markup
      // assertions in this file, but mocked here to keep test output clean.
      user: { findUnique: vi.fn(() => Promise.resolve(null)) },
      supplierProfile: { findUnique: vi.fn(() => Promise.resolve(null)) },
      product: { findUnique: vi.fn(() => Promise.resolve(null)) },
    },
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
    notifyPaymentRequired: vi.fn(() => Promise.resolve()),
    resolveMarkupForProduct: vi.fn(async (_tx: any, params: { productId: string; supplierUnitPrice: number }) => {
      const configured = markupByProductId.get(params.productId);
      if (!configured) return null;
      const buyerUnitPrice =
        Math.round((params.supplierUnitPrice * (1 + configured.markupPercent / 100) + Number.EPSILON) * 100) / 100;
      return {
        supplierUnitPrice: params.supplierUnitPrice,
        buyerUnitPrice,
        markupPercent: configured.markupPercent,
        markupAmount: Math.round((buyerUnitPrice - params.supplierUnitPrice + Number.EPSILON) * 100) / 100,
      };
    }),
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn(() => Promise.resolve({})) }));

import { updateSupplierOrderStatus } from "./supplier-data";

beforeEach(() => {
  orderRows.clear();
  orderItemUpdateCalls.length = 0;
  orderUpdateCalls.length = 0;
  markupByProductId.clear();
  orderItemFindManyMock.mockReset();
  orderItemFindManyMock.mockImplementation(async (args: any) => {
    const order = Array.from(orderRows.values()).find((o) => o.id === args?.where?.orderId);
    const items = order ? order.items : [];
    return items.map((item: any) => {
      const updated = orderItemUpdateCalls.find((c) => c.where.id === item.id);
      return { unitPrice: updated ? updated.data.unitPrice : item.unitPrice, quantity: item.quantity };
    });
  });
});

function seedDecliningOrder(id: string, overrides: Partial<any> = {}) {
  orderRows.set(id, {
    id,
    status: "PLACED",
    paymentStatus: "PENDING",
    userId: "builder-1",
    items: [
      {
        id: "line-1",
        productId: "prod-1",
        supplierId: "sup-declining",
        quantity: 10,
        unitPrice: 1000,
        allCandidatesDeclined: false,
        product: { categoryId: "cat-1" },
        candidates: [
          { id: "cand-declining", supplierId: "sup-declining", status: "PENDING", unitPrice: 1000, rank: 0, listingId: "listing-a" },
          { id: "cand-next", supplierId: "sup-next", status: "PENDING", unitPrice: 900, rank: 1, listingId: "listing-b" },
        ],
      },
    ],
    ...overrides,
  });
}

describe("declineOrderForSupplier (via updateSupplierOrderStatus CANCELLED) — Admin-Configurable Product Markup", () => {
  it("applies the applicable markup to the promoted candidate's price, never the raw candidate price", async () => {
    seedDecliningOrder("order-decline-1");
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await updateSupplierOrderStatus("order-decline-1", "CANCELLED" as any, "sup-declining");

    const promotion = orderItemUpdateCalls.find((c) => c.where.id === "line-1" && c.data.supplierId === "sup-next");
    expect(promotion).toBeDefined();
    // Candidate's original price (900) * 1.10 = 990 — never the raw 900.
    expect(promotion.data).toMatchObject({
      supplierId: "sup-next",
      unitPrice: 990,
      supplierUnitPrice: 900,
      markupPercent: 10,
      markupAmount: 90,
    });
  });

  it("recalculates Order.totalAmount after promotion, using the marked-up price", async () => {
    seedDecliningOrder("order-decline-2");
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await updateSupplierOrderStatus("order-decline-2", "CANCELLED" as any, "sup-declining");

    const totalUpdate = orderUpdateCalls.find((c) => c.where.id === "order-decline-2" && c.data.totalAmount !== undefined);
    expect(totalUpdate).toBeDefined();
    // quantity 10 * marked-up unit price 990 = 9900 (never 10 * 900 = 9000).
    expect(totalUpdate.data.totalAmount).toBe(9900);
  });

  it("honours an explicit 0% override on promotion", async () => {
    seedDecliningOrder("order-decline-3");
    markupByProductId.set("prod-1", { markupPercent: 0 });

    await updateSupplierOrderStatus("order-decline-3", "CANCELLED" as any, "sup-declining");

    const promotion = orderItemUpdateCalls.find((c) => c.where.id === "line-1");
    expect(promotion.data).toMatchObject({ unitPrice: 900, supplierUnitPrice: 900, markupPercent: 0, markupAmount: 0 });
  });

  it("falls back to 0% markup (never blocks the decline/promotion) when no markup configuration exists", async () => {
    seedDecliningOrder("order-decline-4");
    // No markupByProductId entry seeded -> resolveMarkupForProduct returns null.

    await updateSupplierOrderStatus("order-decline-4", "CANCELLED" as any, "sup-declining");

    const promotion = orderItemUpdateCalls.find((c) => c.where.id === "line-1");
    expect(promotion.data).toMatchObject({ unitPrice: 900, supplierUnitPrice: 900, markupPercent: 0, markupAmount: 0 });
  });

  it("leaves unaffected lines (assigned to a different, non-declining supplier) untouched across multiple order lines", async () => {
    seedDecliningOrder("order-decline-5", {
      items: [
        {
          id: "line-1",
          productId: "prod-1",
          supplierId: "sup-declining",
          quantity: 10,
          unitPrice: 1000,
          allCandidatesDeclined: false,
          product: { categoryId: "cat-1" },
          candidates: [
            { id: "cand-declining", supplierId: "sup-declining", status: "PENDING", unitPrice: 1000, rank: 0, listingId: "listing-a" },
            { id: "cand-next", supplierId: "sup-next", status: "PENDING", unitPrice: 900, rank: 1, listingId: "listing-b" },
          ],
        },
        {
          id: "line-2",
          productId: "prod-2",
          supplierId: "sup-unrelated",
          quantity: 5,
          unitPrice: 500,
          allCandidatesDeclined: false,
          product: { categoryId: "cat-2" },
          candidates: [
            { id: "cand-unrelated", supplierId: "sup-unrelated", status: "PENDING", unitPrice: 500, rank: 0, listingId: "listing-c" },
          ],
        },
      ],
    });
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await updateSupplierOrderStatus("order-decline-5", "CANCELLED" as any, "sup-declining");

    const line2Update = orderItemUpdateCalls.find((c) => c.where.id === "line-2");
    expect(line2Update).toBeUndefined();

    const totalUpdate = orderUpdateCalls.find((c) => c.where.id === "order-decline-5" && c.data.totalAmount !== undefined);
    // line-1 marked up (10 * 990 = 9900) + line-2 unchanged (5 * 500 = 2500) = 12400.
    expect(totalUpdate.data.totalAmount).toBe(12400);
  });

  it("does not apply markup again when no promotion occurs (all candidates declined)", async () => {
    seedDecliningOrder("order-decline-6", {
      items: [
        {
          id: "line-1",
          productId: "prod-1",
          supplierId: "sup-declining",
          quantity: 10,
          unitPrice: 1000,
          allCandidatesDeclined: false,
          product: { categoryId: "cat-1" },
          candidates: [
            { id: "cand-declining", supplierId: "sup-declining", status: "PENDING", unitPrice: 1000, rank: 0, listingId: "listing-a" },
          ],
        },
      ],
    });
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await updateSupplierOrderStatus("order-decline-6", "CANCELLED" as any, "sup-declining");

    const priceUpdate = orderItemUpdateCalls.find((c) => c.where.id === "line-1" && c.data.unitPrice !== undefined);
    expect(priceUpdate).toBeUndefined();
    const totalUpdate = orderUpdateCalls.find((c) => c.where.id === "order-decline-6" && c.data.totalAmount !== undefined);
    expect(totalUpdate).toBeUndefined();
  });
});
