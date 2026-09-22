// Regression test for the "/rfqs is empty even though Pending Enquiries
// shows data" bug: getSupplierRfqs (lib/supplier-data.ts) must surface both
// real QuickRequest rows AND PLACED order enquiries for this supplier, since
// no current builder-facing flow creates QuickRequest rows (see comment on
// getSupplierRfqs). Mocks @matsrc/db so no real database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { quickRequestRows, orderItemRows } = vi.hoisted(() => {
  return {
    quickRequestRows: [] as any[],
    orderItemRows: [] as any[],
  };
});

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      // ensureSupplierContext (called internally by getSupplierRfqs) looks
      // this up first — always resolve to a supplier that already has a
      // SupplierProfile so the create-profile branch never runs.
      user: {
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({
            id: "user-1",
            name: "Acme",
            email: "supplier@example.com",
            phone: null,
            whatsappNumber: null,
            kycStatus: "APPROVED",
            supplierProfile: { id: "supplier-1", companyName: "Acme", bisLicenceNo: null, region: null },
          })
        ),
      },
      quickRequest: {
        findMany: vi.fn(() => Promise.resolve(quickRequestRows)),
      },
      orderItem: {
        findMany: vi.fn(() => Promise.resolve(orderItemRows)),
      },
    },
  };
});

vi.mock("./notify", () => ({
  notifyBuilderOrderStatusUpdate: vi.fn(() => Promise.resolve()),
}));

vi.mock("./twilio-whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(() => Promise.resolve({})),
}));

import { getSupplierRfqs } from "./supplier-data";

beforeEach(() => {
  quickRequestRows.length = 0;
  orderItemRows.length = 0;
});

describe("getSupplierRfqs", () => {
  it("returns real QuickRequest RFQs tagged source: RFQ", async () => {
    quickRequestRows.push({
      id: "rfq-1",
      materialName: "TMT Bar",
      quantity: "5 MT",
      pincode: "600001",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      quotes: [],
    });

    const result = await getSupplierRfqs("supplier@example.com");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "rfq-1", source: "RFQ", material: "TMT Bar" });
  });

  it("falls back to PLACED order enquiries tagged source: ENQUIRY when there are no QuickRequest rows", async () => {
    orderItemRows.push({
      orderId: "order-1",
      quantity: 10,
      deliveryDate: null,
      product: { name: "OPC Cement", unit: "BAG" },
      order: { deliveryAddress: "Site A, Chennai", deliveryDate: new Date("2026-02-01T00:00:00Z") },
    });

    const result = await getSupplierRfqs("supplier@example.com");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "order-1",
      source: "ENQUIRY",
      material: "OPC Cement",
      quantity: "10 BAG",
      pincode: "Site A, Chennai",
    });
  });

  it("merges both sources when both exist, never dropping either", async () => {
    quickRequestRows.push({
      id: "rfq-1",
      materialName: "TMT Bar",
      quantity: "5 MT",
      pincode: "600001",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      quotes: [],
    });
    orderItemRows.push({
      orderId: "order-1",
      quantity: 10,
      deliveryDate: null,
      product: { name: "OPC Cement", unit: "BAG" },
      order: { deliveryAddress: "Site A, Chennai", deliveryDate: new Date("2026-02-01T00:00:00Z") },
    });

    const result = await getSupplierRfqs("supplier@example.com");
    const ids = result.map((r) => r.id);
    expect(ids).toContain("rfq-1");
    expect(ids).toContain("order-1");
    expect(result).toHaveLength(2);
  });

  it("returns an empty list (not an error) when neither source has data", async () => {
    const result = await getSupplierRfqs("supplier@example.com");
    expect(result).toEqual([]);
  });
});
