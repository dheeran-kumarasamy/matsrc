// Focused test for updateSupplierOrderStatus's backend transition guard
// (lib/supplier-data.ts) — verifies that invalid supplier-triggered
// transitions are rejected at the data-layer level, independent of
// whatever the UI (OrderStatusActions.tsx) happens to render. Mocks
// @matsrc/db and this module's other external dependencies so no real
// database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { orderRows, findUniqueCalls, updateCalls } = vi.hoisted(() => {
  const orderRows = new Map<string, { id: string; status: string; items: any[] }>();
  const findUniqueCalls: any[] = [];
  const updateCalls: any[] = [];
  return { orderRows, findUniqueCalls, updateCalls };
});

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      order: {
        findUnique: vi.fn((args: any) => {
          findUniqueCalls.push(args);
          const row = orderRows.get(args.where.id);
          if (!row) return Promise.resolve(null);
          if (args.select) {
            const picked: any = {};
            for (const key of Object.keys(args.select)) picked[key] = (row as any)[key];
            return Promise.resolve(picked);
          }
          return Promise.resolve(row);
        }),
        update: vi.fn((args: any) => {
          updateCalls.push(args);
          const row = orderRows.get(args.where.id);
          const updated = { ...row, ...args.data };
          orderRows.set(args.where.id, updated as any);
          return Promise.resolve(updated);
        }),
      },
      orderTracking: {
        create: vi.fn(() => Promise.resolve({})),
      },
      orderItemSupplierCandidate: {
        update: vi.fn(() => Promise.resolve({})),
      },
      orderItem: {
        update: vi.fn(() => Promise.resolve({})),
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

import { updateSupplierOrderStatus } from "./supplier-data";

beforeEach(() => {
  orderRows.clear();
  findUniqueCalls.length = 0;
  updateCalls.length = 0;
});

function seedOrder(id: string, status: string) {
  orderRows.set(id, { id, status, items: [] });
}

describe("updateSupplierOrderStatus — backend transition guard", () => {
  it("allows Confirm Enquiry (PLACED -> PROCESSING)", async () => {
    seedOrder("order-1", "PLACED");
    const result = await updateSupplierOrderStatus("order-1", "PROCESSING" as any);
    expect(result.status).toBe("PROCESSING");
  });

  it("rejects Confirm Enquiry after the enquiry has already been accepted", async () => {
    seedOrder("order-2", "PROCESSING");
    await expect(updateSupplierOrderStatus("order-2", "PROCESSING" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("rejects Decline Enquiry after the enquiry has already been accepted", async () => {
    seedOrder("order-3", "PROCESSING");
    await expect(
      updateSupplierOrderStatus("order-3", "CANCELLED" as any, "supplier-1")
    ).rejects.toThrow(/Invalid order status transition/);
  });

  it("rejects Mark Dispatched before the enquiry has been accepted", async () => {
    seedOrder("order-4", "PLACED");
    await expect(updateSupplierOrderStatus("order-4", "DISPATCHED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("allows Mark Dispatched once accepted (PROCESSING -> DISPATCHED)", async () => {
    seedOrder("order-5", "PROCESSING");
    const result = await updateSupplierOrderStatus("order-5", "DISPATCHED" as any);
    expect(result.status).toBe("DISPATCHED");
  });

  it("rejects Mark Delivered before dispatch", async () => {
    seedOrder("order-6", "PROCESSING");
    await expect(updateSupplierOrderStatus("order-6", "DELIVERED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("allows Mark Delivered once dispatched (DISPATCHED -> DELIVERED)", async () => {
    seedOrder("order-7", "DISPATCHED");
    const result = await updateSupplierOrderStatus("order-7", "DELIVERED" as any);
    expect(result.status).toBe("DELIVERED");
  });

  it("rejects any transition attempted after the order has already been delivered", async () => {
    seedOrder("order-8", "DELIVERED");
    await expect(updateSupplierOrderStatus("order-8", "PROCESSING" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
    await expect(updateSupplierOrderStatus("order-8", "CANCELLED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("throws a not-found error for an order that doesn't exist", async () => {
    await expect(updateSupplierOrderStatus("missing-order", "PROCESSING" as any)).rejects.toThrow(
      /Order not found/
    );
  });
});
