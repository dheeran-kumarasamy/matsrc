// API-level tests for GET /api/builder/orders/[id] — Product-Level GST /
// GST-Inclusive Buyer Payable (Phase 4). Prisma is mocked (same pattern as
// lib/order-cancellation-route.spec.ts); no real database/network calls.
//
// Focus: the order-detail page's `total`/`totalLabel` (and the payment page
// that reads them, via OrderPaymentPanels' initialTotal) must reflect the
// frozen, GST-inclusive finalPayableAmount for a confirmed order, and the
// pre-existing GST-exclusive totalAmount for a legacy/not-yet-confirmed one.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();
const creditProfileFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: { findFirst: (...args: unknown[]) => orderFindFirst(...args) },
    creditProfile: { findUnique: (...args: unknown[]) => creditProfileFindUnique(...args) },
  },
  formatCurrency: (amount: number) => `₹${Number(amount).toLocaleString("en-IN")}`,
  formatDate: () => null,
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

function makeRequest(): Request {
  return new Request("http://localhost/api/builder/orders/order-1", {
    headers: { "X-User-Id": "owner", "X-User-Email": "owner@example.com" },
  });
}

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    enquiryId: "EQ/2601/00001",
    orderNumber: null,
    status: "PROCESSING",
    paymentMethod: "BANK_TRANSFER",
    paymentStatus: "PENDING",
    totalAmount: 10000,
    taxAmount: null,
    finalPayableAmount: null,
    advancePercent: null,
    requiredAdvanceAmount: null,
    deliveryDate: null,
    quoteSelectionCompletedAt: null,
    isAggregated: false,
    aggregationPoolId: null,
    priceBeforeAggregation: null,
    priceAfterAggregation: null,
    siteId: null,
    site: null,
    aggregationPool: null,
    purchaseOrders: [],
    invoice: null,
    items: [{ id: "item-1", quantity: 1, unitPrice: 10000, product: { id: "p1", name: "Cement", unit: "bag", supplier: { id: "s1", companyName: "Acme" } } }],
    tracking: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  creditProfileFindUnique.mockResolvedValue(null);
});

describe("GET /api/builder/orders/[id] — GST-inclusive payable surfacing", () => {
  it("returns finalPayableAmount as the total for a confirmed order with a complete snapshot", async () => {
    orderFindFirst.mockResolvedValue(
      baseOrder({ totalAmount: 10000, taxAmount: 1800, finalPayableAmount: 11800 })
    );

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(11800);
    expect(body.gstInclusive).toBe(true);
    expect(body.subtotalBeforeTax).toBe(10000);
    expect(body.taxAmount).toBe(1800);
  });

  it("falls back to totalAmount for a legacy order with a null finalPayableAmount, without inferring zero tax", async () => {
    orderFindFirst.mockResolvedValue(baseOrder({ totalAmount: 10000, taxAmount: null, finalPayableAmount: null }));

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(10000);
    expect(body.gstInclusive).toBe(false);
    expect(body.taxAmount).toBeNull();
  });

  it("returns 500 for an order whose snapshot is inconsistent (fail safe, never guesses)", async () => {
    orderFindFirst.mockResolvedValue(baseOrder({ totalAmount: 10000, taxAmount: 1800, finalPayableAmount: null }));

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });

    expect(response.status).toBe(500);
  });
});

// Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
// Dispatch — the buyer-facing confirmationState/confirmationStateLabel and
// the final payable `total` must correctly reflect the order's
// SupplierInvoice state, never the raw Order.status alone.
describe("GET /api/builder/orders/[id] — Admin-Confirmed Freight / Buyer Final Confirmation", () => {
  it("is NOT_YET_CONFIRMED while the order is still PLACED", async () => {
    orderFindFirst.mockResolvedValue(baseOrder({ status: "PLACED", supplierInvoice: null }));

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(body.confirmationState).toBe("NOT_YET_CONFIRMED");
    expect(body.paymentLinkAvailable).toBe(false);
  });

  it("is AWAITING_FINAL_CONFIRMATION once the supplier accepts but no SupplierInvoice exists yet", async () => {
    orderFindFirst.mockResolvedValue(baseOrder({ status: "PROCESSING", supplierInvoice: null }));

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(body.confirmationState).toBe("AWAITING_FINAL_CONFIRMATION");
    // Payment must never be offered before final confirmation, even though
    // the raw Order.status is already PROCESSING and paymentStatus PENDING.
    expect(body.paymentLinkAvailable).toBe(false);
  });

  it("is AWAITING_FINAL_CONFIRMATION while the SupplierInvoice is PENDING_REVIEW", async () => {
    orderFindFirst.mockResolvedValue(
      baseOrder({ status: "PROCESSING", supplierInvoice: { status: "PENDING_REVIEW", confirmedTotalAmount: null } })
    );

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(body.confirmationState).toBe("AWAITING_FINAL_CONFIRMATION");
    expect(body.paymentLinkAvailable).toBe(false);
  });

  it("is CONFIRMED once the supplier has accepted AND the SupplierInvoice is CONFIRMED, exposing the admin-confirmed total", async () => {
    orderFindFirst.mockResolvedValue(
      baseOrder({
        status: "PROCESSING",
        totalAmount: 10000,
        taxAmount: 1800,
        finalPayableAmount: 11800,
        supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 13500 },
      })
    );

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(body.confirmationState).toBe("CONFIRMED");
    expect(body.total).toBe(13500); // admin-confirmed, NOT the pre-confirmation 11800
    expect(body.paymentLinkAvailable).toBe(true);
  });

  it("legacy/in-flight order compatibility: treats an already-DISPATCHED order with no SupplierInvoice as CONFIRMED (never permanently stranded)", async () => {
    orderFindFirst.mockResolvedValue(baseOrder({ status: "DISPATCHED", supplierInvoice: null }));

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(body.confirmationState).toBe("CONFIRMED");
  });

  it("CANCELLED always wins, even if the SupplierInvoice was confirmed", async () => {
    orderFindFirst.mockResolvedValue(
      baseOrder({ status: "CANCELLED", supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 13500 } })
    );

    const { GET } = await import("../app/api/builder/orders/[id]/route");
    const response = await GET(makeRequest(), { params: { id: "order-1" } });
    const body = await response.json();

    expect(body.confirmationState).toBe("CANCELLED");
    expect(body.paymentLinkAvailable).toBe(false);
  });
});
