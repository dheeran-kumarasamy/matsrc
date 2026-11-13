// Route-level tests for GET /api/builder/advance/transactions.
// Prisma and the auth context (getUserCtx/getOrCreateBuilder) are mocked;
// no real database/network calls. Placed under lib/ to match
// vitest.config.ts's include pattern ("lib/**/*.spec.ts").
//
// Focus: legacy/receipt-less transaction compatibility (Release Hardening
// item E) — a CREDIT transaction created before the Advance Payment Receipt
// feature existed has no AdvanceReceipt row, and the route must return
// receiptId/receiptNumber as null rather than erroring or omitting the
// fields, so the buyer-facing history UI never renders a broken download
// link for it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserCtx = vi.fn((..._args: unknown[]) => ({ userId: "user-1", email: "builder@example.com", name: "Builder" }));
const getOrCreateBuilder = vi.fn(async (..._args: unknown[]) => ({ id: "user-1", email: "builder@example.com", name: "Builder" }));
const customerAdvanceAccountFindUnique = vi.fn();
const customerAdvanceTransactionFindMany = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    customerAdvanceAccount: { findUnique: (...args: unknown[]) => customerAdvanceAccountFindUnique(...args) },
    customerAdvanceTransaction: { findMany: (...args: unknown[]) => customerAdvanceTransactionFindMany(...args) },
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  getUserCtx: (...args: unknown[]) => getUserCtx(...args),
}));

function makeRequest(): Request {
  return new Request("https://example.com/api/builder/advance/transactions");
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserCtx.mockReturnValue({ userId: "user-1", email: "builder@example.com", name: "Builder" });
  getOrCreateBuilder.mockResolvedValue({ id: "user-1", email: "builder@example.com", name: "Builder" });
  customerAdvanceAccountFindUnique.mockResolvedValue({ id: "acct-1" });
});

describe("GET /api/builder/advance/transactions", () => {
  it("returns an empty list when the buyer has no advance account yet", async () => {
    customerAdvanceAccountFindUnique.mockResolvedValue(null);

    const { GET } = await import("@/app/api/builder/advance/transactions/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.transactions).toEqual([]);
    expect(customerAdvanceTransactionFindMany).not.toHaveBeenCalled();
  });

  it("returns receiptId/receiptNumber: null for a legacy CREDIT transaction with no AdvanceReceipt row (no broken link)", async () => {
    customerAdvanceTransactionFindMany.mockResolvedValue([
      {
        id: "tx-legacy",
        type: "CREDIT",
        amount: 25000,
        balanceAfter: 25000,
        reference: "AP/2509/00001",
        createdAt: new Date("2025-09-01T00:00:00.000Z"),
        order: null,
        advancePayment: { id: "ap-legacy", referenceNumber: "AP/2509/00001" },
        // Legacy row created before the Advance Payment Receipt feature
        // existed — Prisma's nullable 1:1 include resolves to null.
        receipt: null,
      },
    ]);

    const { GET } = await import("@/app/api/builder/advance/transactions/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].receiptId).toBeNull();
    expect(body.transactions[0].receiptNumber).toBeNull();
    // Every pre-existing field remains intact and correctly typed —
    // confirms this feature did not regress the existing response shape.
    expect(body.transactions[0].type).toBe("CREDIT");
    expect(body.transactions[0].amount).toBe(25000);
    expect(body.transactions[0].balanceAfter).toBe(25000);
    expect(body.transactions[0].advancePaymentReference).toBe("AP/2509/00001");
  });

  it("returns receiptId/receiptNumber populated for a settled CREDIT transaction that DOES have a receipt", async () => {
    customerAdvanceTransactionFindMany.mockResolvedValue([
      {
        id: "tx-new",
        type: "CREDIT",
        amount: 50000,
        balanceAfter: 50000,
        reference: "AP/2601/00001",
        createdAt: new Date("2026-01-15T00:00:00.000Z"),
        order: null,
        advancePayment: { id: "ap-new", referenceNumber: "AP/2601/00001" },
        receipt: { id: "receipt-1", receiptNumber: "AR/2601/00001" },
      },
    ]);

    const { GET } = await import("@/app/api/builder/advance/transactions/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.transactions[0].receiptId).toBe("receipt-1");
    expect(body.transactions[0].receiptNumber).toBe("AR/2601/00001");
  });

  it("never populates receiptId for a non-CREDIT transaction type (e.g. ORDER_PAYMENT), matching the schema's CREDIT-only receipt relation", async () => {
    customerAdvanceTransactionFindMany.mockResolvedValue([
      {
        id: "tx-order-payment",
        type: "ORDER_PAYMENT",
        amount: 10000,
        balanceAfter: 40000,
        reference: "ORD-1",
        createdAt: new Date("2026-01-20T00:00:00.000Z"),
        order: { id: "order-1", enquiryId: "ORD-1", orderNumber: null },
        advancePayment: null,
        receipt: null,
      },
    ]);

    const { GET } = await import("@/app/api/builder/advance/transactions/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.transactions[0].type).toBe("ORDER_PAYMENT");
    expect(body.transactions[0].receiptId).toBeNull();
  });
});
