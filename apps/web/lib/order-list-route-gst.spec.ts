// API-level tests for GET /api/builder/orders (list) — Product-Level GST /
// GST-Inclusive Buyer Payable (Phase 4). Prisma is mocked; no real
// database/network calls.
//
// Focus: the order list's `total`/`totalLabel`/`gstInclusive` must reflect
// the frozen, GST-inclusive finalPayableAmount for a confirmed order, and
// the pre-existing GST-exclusive totalAmount for a legacy/not-yet-confirmed
// one — each order in the list is resolved independently.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindMany = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: { order: { findMany: (...args: unknown[]) => orderFindMany(...args) } },
  formatCurrency: (amount: number) => `₹${Number(amount).toLocaleString("en-IN")}`,
  getOrCreateBuilder: async (userId: string) => ({ id: userId }),
  getUserCtx: (request: Request) => {
    const userId = request.headers.get("X-User-Id");
    const email = request.headers.get("X-User-Email");
    if (!userId || !email) throw new Error("UNAUTHENTICATED");
    return { userId, email, name: "Builder" };
  },
}));

vi.mock("@/lib/supplier-display", () => ({
  getSupplierDisplayName: (name: string | null | undefined) => name ?? "Supplier",
}));

vi.mock("@/lib/order-checkout", () => ({ createOrdersFromCart: vi.fn() }));

function makeRequest(): Request {
  return new Request("http://localhost/api/builder/orders", {
    headers: { "X-User-Id": "owner", "X-User-Email": "owner@example.com" },
  });
}

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    enquiryId: "EQ/2601/00001",
    orderNumber: null,
    status: "PROCESSING",
    paymentStatus: "PENDING",
    totalAmount: 10000,
    taxAmount: null,
    finalPayableAmount: null,
    advancePercent: null,
    requiredAdvanceAmount: null,
    createdAt: new Date("2026-01-01"),
    isAggregated: false,
    aggregationPoolId: null,
    siteId: null,
    site: null,
    items: [{ id: "item-1", product: { supplier: { id: "s1", companyName: "Acme" } } }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/builder/orders — GST-inclusive payable surfacing", () => {
  it("returns finalPayableAmount as the total for a confirmed order", async () => {
    orderFindMany.mockResolvedValue([makeOrderRow({ totalAmount: 10000, taxAmount: 1800, finalPayableAmount: 11800 })]);

    const { GET } = await import("../app/api/builder/orders/route");
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0].total).toBe(11800);
    expect(body[0].gstInclusive).toBe(true);
  });

  it("falls back to totalAmount for a legacy order in the same list", async () => {
    orderFindMany.mockResolvedValue([
      makeOrderRow({ id: "order-new", totalAmount: 10000, taxAmount: 1800, finalPayableAmount: 11800 }),
      makeOrderRow({ id: "order-legacy", totalAmount: 5000, taxAmount: null, finalPayableAmount: null }),
    ]);

    const { GET } = await import("../app/api/builder/orders/route");
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.find((o: any) => o.id === "order-new").total).toBe(11800);
    expect(body.find((o: any) => o.id === "order-legacy").total).toBe(5000);
    expect(body.find((o: any) => o.id === "order-legacy").gstInclusive).toBe(false);
  });
});
