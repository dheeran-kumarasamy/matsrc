// S15 — Supplier portal customer-facing Order ID fix.
//
// Regression tests confirming that every supplier data-layer read
// function (getSupplierOrders, getSupplierOrderDetail,
// getSupplierPurchaseOrders, getSupplierPurchaseOrderDetail) surfaces the
// canonical business identifier (orderNumber ?? enquiryId) alongside the
// existing internal `id`/`orderId`, and never derives a visible label
// from the raw cuid.
//
// Mocks @matsrc/db so no real database is touched, following the existing
// pattern in lib/supplier-order-brand-activity.spec.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  userRow,
  orderItemFindManyRows,
  orderItemFindFirstRow,
  purchaseOrderFindManyRows,
  purchaseOrderFindFirstRow,
} = vi.hoisted(() => {
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
    purchaseOrderFindManyRows: [] as any[],
    purchaseOrderFindFirstRow: { current: null as any },
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
        findMany: vi.fn(() => Promise.resolve(purchaseOrderFindManyRows)),
        findFirst: vi.fn(() => Promise.resolve(purchaseOrderFindFirstRow.current)),
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
import { getSupplierPurchaseOrders, getSupplierPurchaseOrderDetail } from "./purchase-order-data";

beforeEach(() => {
  orderItemFindManyRows.length = 0;
  orderItemFindFirstRow.current = null;
  purchaseOrderFindManyRows.length = 0;
  purchaseOrderFindFirstRow.current = null;
});

const CUID_LIKE = /^c[a-z0-9]{20,}$/i;

describe("Case 6 — getSupplierOrders surfaces the business identifier", () => {
  it("prefers orderNumber over enquiryId when both exist", async () => {
    orderItemFindManyRows.push({
      orderId: "cck8g2h3o0000qzrm5f1a2b3c",
      quantity: 5,
      order: {
        orderNumber: "OD/2627/01/00001",
        enquiryId: "EQ/2627/01/00001",
        user: { name: "Builder Co", phone: null },
        status: "PROCESSING",
        isAggregated: false,
        aggregationPoolId: null,
      },
      product: { name: "TMT Bar", unit: "MT", brand: null, brandRef: { name: "Tata Tiscon" } },
    });

    const result = await getSupplierOrders("supplier@example.com");
    expect(result[0].displayOrderNumber).toBe("OD/2627/01/00001");
    // Case 5 — the internal id remains available for routing/lookups.
    expect(result[0].id).toBe("cck8g2h3o0000qzrm5f1a2b3c");
    expect(result[0].displayOrderNumber).not.toMatch(CUID_LIKE);
  });

  it("falls back to enquiryId when orderNumber has not yet been generated", async () => {
    orderItemFindManyRows.push({
      orderId: "order-2",
      quantity: 5,
      order: {
        orderNumber: null,
        enquiryId: "EQ/2627/01/00002",
        user: { name: "Builder Co", phone: null },
        status: "PLACED",
        isAggregated: false,
        aggregationPoolId: null,
      },
      product: { name: "OPC Cement", unit: "BAG", brand: "UltraTech", brandRef: null },
    });

    const result = await getSupplierOrders("supplier@example.com");
    expect(result[0].displayOrderNumber).toBe("EQ/2627/01/00002");
  });

  it("never exposes the raw internal id as the business identifier when neither business ID exists", async () => {
    orderItemFindManyRows.push({
      orderId: "order-3",
      quantity: 5,
      order: {
        orderNumber: null,
        enquiryId: null,
        user: { name: "Builder Co", phone: null },
        status: "PLACED",
        isAggregated: false,
        aggregationPoolId: null,
      },
      product: { name: "Generic Sand", unit: "MT", brand: null, brandRef: null },
    });

    const result = await getSupplierOrders("supplier@example.com");
    expect(result[0].displayOrderNumber).not.toBe("order-3");
    expect(result[0].id).toBe("order-3");
  });
});

describe("Case 7 — getSupplierOrderDetail uses the same business identifier as the list", () => {
  function seedDetail(order: Partial<any> = {}) {
    orderItemFindFirstRow.current = {
      orderId: "order-10",
      quantity: 3,
      unitPrice: 100,
      askPrice: null,
      deliveryDate: null,
      product: { name: "TMT Bar", unit: "MT", brand: null, brandRef: { name: "Tata Tiscon" } },
      order: {
        id: "order-10",
        orderNumber: null,
        enquiryId: "EQ/2627/01/00010",
        user: { name: "Builder Co", phone: null },
        status: "PROCESSING",
        paymentStatus: "PAID",
        deliveryDate: null,
        deliveryAddress: null,
        site: null,
        tracking: [],
        ...order,
      },
    };
  }

  it("surfaces orderNumber once generated", async () => {
    seedDetail({ orderNumber: "OD/2627/01/00010" });
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    expect(detail?.displayOrderNumber).toBe("OD/2627/01/00010");
  });

  it("falls back to enquiryId while orderNumber is still null", async () => {
    seedDetail();
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    expect(detail?.displayOrderNumber).toBe("EQ/2627/01/00010");
  });

  it("Case 5 — retains the internal id for lookups while displayOrderNumber carries the business identifier", async () => {
    seedDetail();
    const detail = await getSupplierOrderDetail("order-10", "supplier@example.com");
    expect(detail?.id).toBe("order-10");
    expect(detail?.displayOrderNumber).not.toBe(detail?.id);
  });
});

describe("Case 10 — PO-related supplier surfaces keep poNumber and add the Order's business reference", () => {
  it("getSupplierPurchaseOrders: poNumber is unchanged; orderReference follows orderNumber ?? enquiryId", async () => {
    purchaseOrderFindManyRows.push({
      id: "po-1",
      poNumber: "PO-2026-00001",
      status: "ISSUED",
      version: 1,
      orderId: "order-20",
      order: { orderNumber: "OD/2627/01/00020", enquiryId: "EQ/2627/01/00020" },
      builder: { name: "Builder Co", email: null },
      lineItems: [],
      approvedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const rows = await getSupplierPurchaseOrders("supplier@example.com");
    expect(rows[0].poNumber).toBe("PO-2026-00001");
    expect(rows[0].orderReference).toBe("OD/2627/01/00020");
    expect(rows[0].orderId).toBe("order-20");
  });

  it("getSupplierPurchaseOrderDetail: falls back to enquiryId when the linked Order has no orderNumber yet", async () => {
    purchaseOrderFindFirstRow.current = {
      id: "po-2",
      poNumber: "PO-2026-00002",
      status: "DRAFT",
      version: 1,
      orderId: "order-21",
      order: { orderNumber: null, enquiryId: "EQ/2627/01/00021" },
      builder: { name: "Builder Co", email: null },
      lineItems: [],
      approvedAt: null,
      approvedBy: null,
      notes: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const detail = await getSupplierPurchaseOrderDetail("po-2", "supplier@example.com");
    expect(detail?.poNumber).toBe("PO-2026-00002");
    expect(detail?.orderReference).toBe("EQ/2627/01/00021");
  });
});
