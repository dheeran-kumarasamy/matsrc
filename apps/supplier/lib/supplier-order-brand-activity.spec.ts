// Regression tests for:
//   S06 — Brand missing in supplier order: getSupplierOrders /
//         getSupplierOrderDetail must surface the product's brand (FK-linked
//         Brand record, falling back to the deprecated free-text column,
//         never "undefined"/"null" when genuinely absent).
//   S11 — Activity timestamps: getSupplierOrderDetail's tracking entries
//         must carry the authoritative OrderTracking.recordedAt event
//         timestamp (never Order.updatedAt), and remain ordered by it.
//
// Mocks @matsrc/db so no real database is touched, following the existing
// pattern in lib/order-status-update.spec.ts / lib/get-supplier-rfqs.spec.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { userRow, orderItemFindManyRows, orderItemFindFirstRow } = vi.hoisted(() => {
  return {
    userRow: {
      id: "user-1",
      name: "Acme",
      email: "supplier@example.com",
      phone: null,
      whatsappNumber: null,
      kycStatus: "APPROVED" as const,
      supplierProfile: { id: "supplier-1", companyName: "Acme", bisLicenceNo: null, region: null },
    },
    orderItemFindManyRows: [] as any[],
    orderItemFindFirstRow: { current: null as any },
  };
});

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      user: {
        findUniqueOrThrow: vi.fn(() => Promise.resolve(userRow)),
      },
      orderItem: {
        findMany: vi.fn(() => Promise.resolve(orderItemFindManyRows)),
        findFirst: vi.fn(() => Promise.resolve(orderItemFindFirstRow.current)),
      },
      purchaseOrder: {
        findFirst: vi.fn(() => Promise.resolve(null)),
      },
    },
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
    notifyPaymentRequired: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("./twilio-whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(() => Promise.resolve({})),
}));

import { getSupplierOrders, getSupplierOrderDetail } from "./supplier-data";

beforeEach(() => {
  orderItemFindManyRows.length = 0;
  orderItemFindFirstRow.current = null;
});

describe("getSupplierOrders — S06 brand resolution", () => {
  it("surfaces the FK-linked Brand name when present", async () => {
    orderItemFindManyRows.push({
      orderId: "order-1",
      quantity: 5,
      order: { user: { name: "Builder Co", phone: null }, status: "PROCESSING", isAggregated: false, aggregationPoolId: null },
      product: { name: "TMT Bar", unit: "MT", brand: null, brandRef: { name: "Tata Tiscon" } },
    });

    const result = await getSupplierOrders("supplier@example.com");
    expect(result[0].brand).toBe("Tata Tiscon");
  });

  it("falls back to the deprecated free-text brand column when brandRef is absent", async () => {
    orderItemFindManyRows.push({
      orderId: "order-2",
      quantity: 5,
      order: { user: { name: "Builder Co", phone: null }, status: "PROCESSING", isAggregated: false, aggregationPoolId: null },
      product: { name: "OPC Cement", unit: "BAG", brand: "UltraTech", brandRef: null },
    });

    const result = await getSupplierOrders("supplier@example.com");
    expect(result[0].brand).toBe("UltraTech");
  });

  it("returns null (never undefined/empty string) when the product has no brand at all", async () => {
    orderItemFindManyRows.push({
      orderId: "order-3",
      quantity: 5,
      order: { user: { name: "Builder Co", phone: null }, status: "PROCESSING", isAggregated: false, aggregationPoolId: null },
      product: { name: "Generic Sand", unit: "MT", brand: null, brandRef: null },
    });

    const result = await getSupplierOrders("supplier@example.com");
    expect(result[0].brand).toBeNull();
    expect(result[0].brand).not.toBe("undefined");
    expect(result[0].brand).not.toBe("");
  });

  it("leaves unrelated existing order fields unchanged", async () => {
    orderItemFindManyRows.push({
      orderId: "order-4",
      quantity: 7,
      order: { user: { name: "Builder Co", phone: null }, status: "DISPATCHED", isAggregated: true, aggregationPoolId: "pool-1" },
      product: { name: "TMT Bar", unit: "MT", brand: null, brandRef: { name: "Tata Tiscon" } },
    });

    const result = await getSupplierOrders("supplier@example.com");
    expect(result[0]).toMatchObject({
      id: "order-4",
      buyer: "Builder Co",
      material: "TMT Bar",
      qty: "7 MT",
      status: "DISPATCHED",
      isAggregated: true,
      aggregationPoolId: "pool-1",
    });
  });
});

describe("getSupplierOrderDetail — S06 brand + S11 activity timestamps", () => {
  function seedDetail(overrides: Partial<any> = {}) {
    orderItemFindFirstRow.current = {
      orderId: "order-10",
      quantity: 3,
      unitPrice: 100,
      askPrice: null,
      deliveryDate: null,
      product: { name: "TMT Bar", unit: "MT", brand: null, brandRef: { name: "Tata Tiscon" } },
      order: {
        id: "order-10",
        user: { name: "Builder Co", phone: null },
        status: "PROCESSING",
        paymentStatus: "PAID",
        deliveryDate: null,
        deliveryAddress: null,
        site: null,
        tracking: [
          { id: "t1", status: "PLACED", note: null, recordedAt: new Date("2026-01-01T10:00:00.000Z") },
          { id: "t2", status: "PROCESSING", note: null, recordedAt: new Date("2026-01-02T11:30:00.000Z") },
        ],
      },
      ...overrides,
    };
  }

  it("surfaces the resolved brand on the order detail", async () => {
    seedDetail();
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    expect(detail?.brand).toBe("Tata Tiscon");
  });

  it("returns null brand (never undefined/null string) when the product has no brand", async () => {
    seedDetail({ product: { name: "Generic Sand", unit: "MT", brand: null, brandRef: null } });
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    expect(detail?.brand).toBeNull();
  });

  it("surfaces each tracking entry's own OrderTracking.recordedAt, not a shared/invented timestamp", async () => {
    seedDetail();
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    expect(detail?.tracking).toHaveLength(2);
    expect(detail?.tracking[0].recordedAt).toBe("2026-01-01T10:00:00.000Z");
    expect(detail?.tracking[1].recordedAt).toBe("2026-01-02T11:30:00.000Z");
    expect(detail?.tracking[0].recordedAt).not.toBe(detail?.tracking[1].recordedAt);
  });

  it("preserves ascending recordedAt ordering as returned by the query (UI reverses for newest-first display)", async () => {
    seedDetail();
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    const times = (detail?.tracking ?? []).map((t) => new Date(t.recordedAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("handles an order with no tracking rows safely", async () => {
    seedDetail();
    orderItemFindFirstRow.current.order.tracking = [];
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    expect(detail?.tracking).toEqual([]);
  });
});
