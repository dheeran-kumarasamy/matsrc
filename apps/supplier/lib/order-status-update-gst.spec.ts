// Product-Level GST / GST-Inclusive Buyer Payable (Phase 3) — focused test
// for updateSupplierOrderStatus's (lib/supplier-data.ts) single-supplier
// "Confirm Enquiry" GST snapshot freeze. Mirrors
// order-status-update.spec.ts's exact hoisted-mock convention, extended
// with taxSetting/advanceConfig/orderItem tables and real items (the
// existing file's seedOrder() always uses items: [], so it never exercises
// this new branch at all).

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  orderRows,
  orderItemUpdateCalls,
  taxSettingRows,
  advanceConfigRow,
  waitUntilMock,
  generateOrderNumberMock,
} = vi.hoisted(() => {
  const orderRows = new Map<string, any>();
  const orderItemUpdateCalls: any[] = [];
  const taxSettingRows: Array<{ scope: string; scopeId: string | null; percentage: number; isEnabled: boolean }> = [];
  const advanceConfigRow: { value: { percentage: number; isEnabled: boolean } | null } = { value: null };
  const waitUntilMock = vi.fn();
  let seq = 0;
  const generateOrderNumberMock = vi.fn(async () => `OD/TEST/${String(++seq).padStart(5, "0")}`);
  return { orderRows, orderItemUpdateCalls, taxSettingRows, advanceConfigRow, waitUntilMock, generateOrderNumberMock };
});

vi.mock("@vercel/functions", () => ({ waitUntil: waitUntilMock }));

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");

  const orderFindUnique = vi.fn((args: any) => {
    const row = orderRows.get(args.where.id);
    if (!row) return Promise.resolve(null);
    if (args.select) {
      const picked: any = {};
      for (const key of Object.keys(args.select)) picked[key] = row[key];
      return Promise.resolve(picked);
    }
    return Promise.resolve(row);
  });
  const orderUpdate = vi.fn((args: any) => {
    const row = orderRows.get(args.where.id);
    const updated = { ...row, ...args.data };
    orderRows.set(args.where.id, updated);
    return Promise.resolve(updated);
  });
  const orderUpdateMany = vi.fn((args: any) => {
    const row = orderRows.get(args.where.id);
    if (!row) return Promise.resolve({ count: 0 });
    if (args.where.quoteSelectionCompletedAt === null && row.quoteSelectionCompletedAt !== null) {
      return Promise.resolve({ count: 0 });
    }
    const updated = { ...row, ...args.data };
    orderRows.set(args.where.id, updated);
    return Promise.resolve({ count: 1 });
  });

  const orderFindUniqueOrThrow = vi.fn((args: any) => {
    const row = orderRows.get(args.where.id);
    if (!row) return Promise.reject(new Error(`Order ${args.where.id} not found`));
    return Promise.resolve(row);
  });

  const prisma: any = {
    order: {
      findUnique: orderFindUnique,
      findUniqueOrThrow: orderFindUniqueOrThrow,
      update: orderUpdate,
      updateMany: orderUpdateMany,
    },
    orderTracking: { create: vi.fn(() => Promise.resolve({})) },
    orderItemSupplierCandidate: { update: vi.fn(() => Promise.resolve({})) },
    orderItem: {
      update: vi.fn((args: any) => {
        orderItemUpdateCalls.push(args);
        return Promise.resolve({});
      }),
    },
    taxSetting: { findMany: vi.fn(async () => taxSettingRows) },
    advanceConfig: { findUnique: vi.fn(async () => (advanceConfigRow.value ? { ...advanceConfigRow.value, id: "global" } : null)) },
    // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
    // Dispatch — this file keeps the REAL checkOrderDispatchEligibility
    // (via vi.importActual below), so these two delegates must exist for
    // its calculateOrderSettledAmount query. Every DISPATCHED-transition
    // fixture in this file sets `supplierInvoice: { status: "CONFIRMED",
    // confirmedTotalAmount: <totalAmount> }` and no ledger/verification
    // rows, which trivially satisfies the gate (0 outstanding) without
    // interfering with the GST-snapshot concerns this file actually tests.
    customerAdvanceTransaction: { findMany: vi.fn(async () => []) },
    paymentVerification: { findUnique: vi.fn(async () => null) },
  };
  prisma.$transaction = vi.fn((callback: any) => callback(prisma));

  return {
    ...actual,
    prisma,
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
    notifyPaymentRequired: vi.fn(() => Promise.resolve()),
    generateOrderNumber: generateOrderNumberMock,
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn(() => Promise.resolve({})) }));

import { updateSupplierOrderStatus } from "./supplier-data";

beforeEach(() => {
  orderRows.clear();
  orderItemUpdateCalls.length = 0;
  taxSettingRows.length = 0;
  advanceConfigRow.value = null;
  waitUntilMock.mockClear();
  generateOrderNumberMock.mockClear();
});

function seedPlacedOrderWithItem(id: string, opts: { supplierUnitPrice?: number; markupPercent?: number } = {}) {
  orderRows.set(id, {
    id,
    status: "PLACED",
    paymentStatus: "PENDING",
    orderNumber: null,
    quoteSelectionCompletedAt: null,
    tentativeDeliveryDate: null,
    deliveryDate: null,
    items: [
      {
        id: `${id}-line-1`,
        productId: "prod-1",
        supplierId: "sup-1",
        quantity: 10,
        unitPrice: opts.supplierUnitPrice
          ? opts.supplierUnitPrice * (1 + (opts.markupPercent ?? 0) / 100)
          : 1100,
        supplierUnitPrice: opts.supplierUnitPrice ?? 1000,
        markupPercent: opts.markupPercent ?? 10,
        product: { categoryId: "cat-1" },
      },
    ],
  });
}

describe("updateSupplierOrderStatus — GST snapshot freeze (single-supplier Confirm Enquiry)", () => {
  it("freezes taxAmount/finalPayableAmount on Order and taxRatePercent/taxAmount on OrderItem", async () => {
    seedPlacedOrderWithItem("order-gst-1");
    taxSettingRows.push({ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true });

    const result = await updateSupplierOrderStatus("order-gst-1", "PROCESSING" as any);

    // buyerUnitPrice=1100, qty=10 -> taxable=11000, tax=1980, payable=12980
    expect((result as any).taxAmount).toBe(1980);
    expect((result as any).finalPayableAmount).toBe(12980);
    expect((result as any).advancePercent).toBeNull();
    expect((result as any).requiredAdvanceAmount).toBeNull();
    expect(orderItemUpdateCalls[0].data).toMatchObject({ taxRatePercent: 18, taxAmount: 1980 });
  });

  it("calculates the informational required advance from the GST-inclusive payable when AdvanceConfig is enabled", async () => {
    seedPlacedOrderWithItem("order-gst-2");
    taxSettingRows.push({ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true });
    advanceConfigRow.value = { percentage: 20, isEnabled: true };

    const result = await updateSupplierOrderStatus("order-gst-2", "PROCESSING" as any);

    expect((result as any).advancePercent).toBe(20);
    expect((result as any).requiredAdvanceAmount).toBe(2596); // 12980 * 0.2
  });

  it("blocks confirmation with no partial writes when no GST configuration exists", async () => {
    seedPlacedOrderWithItem("order-gst-3");
    // taxSettingRows left empty — no GLOBAL/CATEGORY/PRODUCT configured.

    await expect(updateSupplierOrderStatus("order-gst-3", "PROCESSING" as any)).rejects.toThrow(
      /no valid effective GST rate/
    );

    expect(orderItemUpdateCalls).toHaveLength(0);
    expect(orderRows.get("order-gst-3")?.status).toBe("PLACED");
  });

  it("does not reapply markup or rewrite an existing complete snapshot on retry", async () => {
    orderRows.set("order-gst-4", {
      id: "order-gst-4",
      status: "PROCESSING",
      paymentStatus: "PENDING",
      orderNumber: "OD/2601/00001",
      quoteSelectionCompletedAt: new Date("2026-01-02T00:00:00Z"),
      tentativeDeliveryDate: new Date(),
      deliveryDate: null,
      totalAmount: 11000,
      taxAmount: 1980,
      finalPayableAmount: 12980,
      advancePercent: null,
      requiredAdvanceAmount: null,
      // Matching line-level snapshot reconciling with the order-level
      // totals above (assertFullOrderSnapshotIntegrity now requires this
      // for a confirmed order).
      items: [{ id: "order-gst-4-line-1", taxRatePercent: 18, taxAmount: 1980 }],
      // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
      // Dispatch — satisfies checkOrderDispatchEligibility (a confirmed
      // invoice with a 0 confirmedTotalAmount is trivially "fully settled"
      // against the 0 settled amount this mock's empty ledger produces) so
      // this test can reach the SEPARATE GST-snapshot concern it actually
      // exercises.
      supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 0 },
    });

    await expect(updateSupplierOrderStatus("order-gst-4", "DISPATCHED" as any)).resolves.toBeDefined();
    expect(orderItemUpdateCalls).toHaveLength(0);
  });

  it("fails safely (throws) rather than silently repairing a partially-populated snapshot", async () => {
    orderRows.set("order-gst-5", {
      id: "order-gst-5",
      status: "PROCESSING",
      paymentStatus: "PENDING",
      orderNumber: "OD/2601/00002",
      quoteSelectionCompletedAt: new Date("2026-01-02T00:00:00Z"),
      tentativeDeliveryDate: new Date(),
      deliveryDate: null,
      taxAmount: 1980,
      finalPayableAmount: null, // inconsistent
      advancePercent: null,
      requiredAdvanceAmount: null,
      items: [],
      // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
      // Dispatch — satisfies checkOrderDispatchEligibility so this test can
      // reach the SEPARATE snapshot-integrity check it actually exercises.
      supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 0 },
    });

    await expect(updateSupplierOrderStatus("order-gst-5", "DISPATCHED" as any)).rejects.toThrow(
      /inconsistent financial snapshot/
    );
  });

  it("loses a concurrent confirmation race safely: returns the winner's result without a second write", async () => {
    seedPlacedOrderWithItem("order-gst-6");
    taxSettingRows.push({ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true });

    // Simulate a concurrent winner committing between our read and write:
    // mutate the row to already be confirmed right before updateMany runs.
    const originalUpdateMany = (await import("@matsrc/db")).prisma.order.updateMany as any;
    (originalUpdateMany as any).mockImplementationOnce((args: any) => {
      const row = orderRows.get(args.where.id);
      // Mark as already confirmed by a "concurrent" request first.
      orderRows.set(args.where.id, {
        ...row,
        status: "PROCESSING",
        quoteSelectionCompletedAt: new Date(),
        totalAmount: 11000,
        taxAmount: 1980,
        finalPayableAmount: 12980,
        advancePercent: null,
        requiredAdvanceAmount: null,
        // Matching line-level snapshot for the "concurrent winner"'s
        // committed order-level totals (assertFullOrderSnapshotIntegrity).
        items: row.items.map((item: any) => ({ ...item, taxRatePercent: 18, taxAmount: 1980 })),
      });
      return Promise.resolve({ count: 0 });
    });

    const result = await updateSupplierOrderStatus("order-gst-6", "PROCESSING" as any);

    expect((result as any).finalPayableAmount).toBe(12980);
    expect(orderItemUpdateCalls).toHaveLength(0);
  });
});
