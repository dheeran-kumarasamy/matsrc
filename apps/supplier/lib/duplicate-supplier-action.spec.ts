// Duplicate supplier-action fix (Supplier Portal Orders: "Review and Submit
// Quotation" vs. "Confirm Enquiry" both appearing for the same enquiry).
//
// Covers:
//   - getSupplierOrderDetail's new `requiresQuotation` flag, derived from
//     whether any of this supplier's line items has more than one eligible
//     OrderItemSupplierCandidate (a genuine competing-supplier RFQ) — see
//     hasMultipleEligibleCandidates's doc comment in lib/supplier-data.ts.
//   - updateSupplierOrderStatus's matching backend guard, which rejects a
//     direct PLACED -> PROCESSING ("Confirm Enquiry") call for an enquiry
//     that requires a quotation first, even if the request bypasses the UI.
//
// Mocks @matsrc/db so no real database is touched, following the existing
// pattern in lib/order-status-update.spec.ts / lib/supplier-order-brand-
// activity.spec.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { userRow, orderItemFindFirstRow, orderItemFindManyRows, orderRows } = vi.hoisted(() => {
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
    orderItemFindFirstRow: { current: null as any },
    // orderItem.findMany is used both by getSupplierOrderDetail's
    // hasMultipleEligibleCandidates lookup (keyed by orderId+supplierId,
    // select: { candidates }) — tests seed this directly.
    orderItemFindManyRows: [] as any[],
    orderRows: new Map<string, { id: string; status: string; items: any[]; paymentStatus: string; orderNumber?: string | null }>(),
  };
});

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

vi.mock("@matsrc/db", () => {
  const orderFindUnique = vi.fn((args: any) => {
    const row = orderRows.get(args.where.id);
    if (!row) return Promise.resolve(null);
    if (args.select) {
      const picked: any = {};
      for (const key of Object.keys(args.select)) picked[key] = (row as any)[key];
      return Promise.resolve(picked);
    }
    return Promise.resolve(row);
  });
  const orderUpdate = vi.fn((args: any) => {
    const row = orderRows.get(args.where.id);
    const updated = { ...row, ...args.data };
    orderRows.set(args.where.id, updated as any);
    return Promise.resolve(updated);
  });

  const prisma: any = {
    user: { findUniqueOrThrow: vi.fn(() => Promise.resolve(userRow)) },
    order: { findUnique: orderFindUnique, update: orderUpdate },
    orderTracking: { create: vi.fn(() => Promise.resolve({})) },
    orderItemSupplierCandidate: { update: vi.fn(() => Promise.resolve({})) },
    orderItem: {
      findFirst: vi.fn(() => Promise.resolve(orderItemFindFirstRow.current)),
      findMany: vi.fn((args: any) => {
        // getSupplierOrderDetail's hasMultipleEligibleCandidates call shape:
        // { where: { orderId, supplierId }, select: { candidates: ... } }.
        if (args?.where?.orderId && args?.where?.supplierId) {
          return Promise.resolve(orderItemFindManyRows);
        }
        return Promise.resolve([]);
      }),
      // Persists onto the matching Order.items row (by id) so
      // declineOrderForSupplier's own fully-declined re-read
      // (prisma.order.findUnique after the loop) observes the update —
      // mirrors the real Prisma behaviour the decline test below depends on.
      update: vi.fn((args: any) => {
        for (const row of orderRows.values()) {
          const item = (row.items ?? []).find((i: any) => i.id === args.where.id);
          if (item) Object.assign(item, args.data);
        }
        return Promise.resolve({});
      }),
    },
    purchaseOrder: { findFirst: vi.fn(() => Promise.resolve(null)) },
    // Consumed by declineOrderForSupplier's advance-reservation release path
    // (irrelevant to this file's decline test, which seeds no reservation).
    customerAdvanceAccount: { findFirst: vi.fn(() => Promise.resolve(null)) },
  };
  prisma.$transaction = vi.fn((callback: any) => callback(prisma));

  return {
    prisma,
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
    notifyPaymentRequired: vi.fn(() => Promise.resolve()),
    generateOrderNumber: vi.fn(async () => "OD/TEST/00001"),
    // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
    // Dispatch — getSupplierOrderDetail calls this (UI-level
    // dispatchBlockedReason convenience only) whenever an order is
    // PROCESSING; this file doesn't exercise that concern, so a trivially
    // eligible stub is enough. Its own real behaviour is covered separately
    // by packages/db/lib/order-dispatch-eligibility.spec.ts.
    checkOrderDispatchEligibility: vi.fn(async () => ({ eligible: true, finalPayableAmount: 0, settledAmount: 0 })),
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn(() => Promise.resolve({})) }));

import { getSupplierOrderDetail, updateSupplierOrderStatus } from "./supplier-data";

beforeEach(() => {
  orderItemFindFirstRow.current = null;
  orderItemFindManyRows.length = 0;
  orderRows.clear();
});

function seedDetail(overrides: Partial<any> = {}) {
  orderItemFindFirstRow.current = {
    orderId: "order-50",
    quantity: 3,
    unitPrice: 100,
    askPrice: null,
    deliveryDate: null,
    product: { name: "TMT Bar", unit: "MT", brand: null, brandRef: null },
    order: {
      id: "order-50",
      user: { name: "Builder Co", phone: null },
      status: "PLACED",
      paymentStatus: "PENDING",
      deliveryDate: null,
      deliveryAddress: null,
      site: null,
      tracking: [],
    },
    ...overrides,
  };
}

describe("getSupplierOrderDetail — requiresQuotation (duplicate supplier-action fix)", () => {
  it("is false for a single-supplier enquiry (exactly one eligible candidate per line item)", async () => {
    seedDetail();
    orderItemFindManyRows.push({ candidates: [{ id: "cand-1" }] });

    const detail = await getSupplierOrderDetail("order-50", "supplier@example.com");
    expect(detail?.requiresQuotation).toBe(false);
  });

  it("is false when a line item has no candidate rows at all (legacy order)", async () => {
    seedDetail();
    orderItemFindManyRows.push({ candidates: [] });

    const detail = await getSupplierOrderDetail("order-50", "supplier@example.com");
    expect(detail?.requiresQuotation).toBe(false);
  });

  it("is true when any line item has more than one eligible candidate (genuine competing RFQ)", async () => {
    seedDetail();
    orderItemFindManyRows.push({ candidates: [{ id: "cand-1" }, { id: "cand-2" }] });

    const detail = await getSupplierOrderDetail("order-50", "supplier@example.com");
    expect(detail?.requiresQuotation).toBe(true);
  });

  it("is always false once the order has moved past PLACED, regardless of candidate count", async () => {
    seedDetail({
      order: {
        id: "order-50",
        user: { name: "Builder Co", phone: null },
        status: "PROCESSING",
        paymentStatus: "PAID",
        deliveryDate: null,
        deliveryAddress: null,
        site: null,
        tracking: [],
      },
    });
    orderItemFindManyRows.push({ candidates: [{ id: "cand-1" }, { id: "cand-2" }] });

    const detail = await getSupplierOrderDetail("order-50", "supplier@example.com");
    expect(detail?.requiresQuotation).toBe(false);
  });
});

describe("updateSupplierOrderStatus — backend guard for competing-supplier RFQs", () => {
  function seedOrder(id: string, status: string, paymentStatus: string = "PAID") {
    orderRows.set(id, { id, status, items: [], paymentStatus, orderNumber: null });
  }

  it("rejects a direct Confirm Enquiry (PLACED -> PROCESSING) when the enquiry has competing supplier candidates", async () => {
    seedOrder("order-60", "PLACED");
    orderItemFindManyRows.push({ candidates: [{ id: "cand-1" }, { id: "cand-2" }] });

    await expect(
      updateSupplierOrderStatus("order-60", "PROCESSING" as any, "supplier-1")
    ).rejects.toThrow(/submit a quotation instead of confirming directly/);
  });

  it("allows Confirm Enquiry when there is only a single eligible candidate (no competing RFQ)", async () => {
    seedOrder("order-61", "PLACED");
    orderItemFindManyRows.push({ candidates: [{ id: "cand-1" }] });

    const result = await updateSupplierOrderStatus("order-61", "PROCESSING" as any, "supplier-1");
    expect(result.status).toBe("PROCESSING");
  });

  it("allows Confirm Enquiry when no acting supplier id is provided (non-portal callers unaffected)", async () => {
    seedOrder("order-62", "PLACED");
    orderItemFindManyRows.push({ candidates: [{ id: "cand-1" }, { id: "cand-2" }] });

    const result = await updateSupplierOrderStatus("order-62", "PROCESSING" as any);
    expect(result.status).toBe("PROCESSING");
  });

  it("never blocks Decline Enquiry (PLACED -> CANCELLED) regardless of candidate count", async () => {
    // declineOrderForSupplier (the fan-out promote-or-cascade path) reads
    // its own candidates straight off Order.items, independent of the
    // requiresQuotation helper's orderItem.findMany lookup above — seed a
    // real item/candidate shape here so the decline path can execute.
    orderRows.set("order-63", {
      id: "order-63",
      status: "PLACED",
      paymentStatus: "PENDING",
      orderNumber: null,
      items: [
        {
          id: "line-1",
          productId: "prod-1",
          supplierId: "supplier-1",
          quantity: 10,
          unitPrice: 1000,
          allCandidatesDeclined: false,
          product: { categoryId: "cat-1" },
          candidates: [
            { id: "cand-declining", supplierId: "supplier-1", status: "PENDING", unitPrice: 1000, rank: 0, listingId: "listing-a" },
          ],
        },
      ],
    } as any);

    const result = await updateSupplierOrderStatus("order-63", "CANCELLED" as any, "supplier-1");
    expect(result.status).toBe("CANCELLED");
  });
});
