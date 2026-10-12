// Route-level tests for GET /api/builder/advance/receipts/[id]/pdf.
// Prisma and the auth context (resolveUserCtx/getOrCreateBuilder) are
// mocked; no real database/network calls. Placed under lib/ to match
// vitest.config.ts's include pattern ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveUserCtx = vi.fn(async (..._args: unknown[]) => ({
  userId: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const getOrCreateBuilder = vi.fn(async (..._args: unknown[]) => ({
  id: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const advanceReceiptFindFirst = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    advanceReceipt: {
      findFirst: (...args: unknown[]) => advanceReceiptFindFirst(...args),
    },
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  resolveUserCtx: (...args: unknown[]) => resolveUserCtx(...args),
}));

function makeRequest(url: string): Request {
  return new Request(url);
}

function fakeReceipt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "receipt-1",
    receiptNumber: "AR/2601/00001",
    issuedAt: new Date("2026-01-15T10:00:00.000Z"),
    transactionId: "tx-1",
    advanceAccountId: "acct-1",
    buyerId: "user-1",
    advancePaymentId: "ap-1",
    amount: 50000,
    balanceAfter: 50000,
    currency: "INR",
    paymentMethod: "MANUAL",
    paymentReferenceNo: "UTR123456",
    buyerName: "Builder",
    buyerEmail: "builder@example.com",
    buyerPhone: "9876543210",
    advancePayment: { referenceNumber: "AP/2601/00001" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveUserCtx.mockResolvedValue({ userId: "user-1", email: "builder@example.com", name: "Builder" });
  getOrCreateBuilder.mockResolvedValue({ id: "user-1", email: "builder@example.com", name: "Builder" });
});

describe("GET /api/builder/advance/receipts/[id]/pdf", () => {
  it("returns 401 (not a generic 500) when the session cannot be resolved", async () => {
    // Mirrors a plain <a href> download navigation with no valid session
    // cookie — resolveUserCtx() throws "UNAUTHENTICATED" in that case (see
    // lib/builder-db.ts), which this route must map to a clean 401 exactly
    // like every other resolveUserCtx()/getUserCtx() consumer in this app.
    resolveUserCtx.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const { GET } = await import("@/app/api/builder/advance/receipts/[id]/pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/advance/receipts/receipt-1/pdf"), {
      params: { id: "receipt-1" },
    });

    expect(res.status).toBe(401);
    expect(advanceReceiptFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when no receipt with that id belongs to the authenticated buyer (never leaks another buyer's receipt)", async () => {
    advanceReceiptFindFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/builder/advance/receipts/[id]/pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/advance/receipts/receipt-1/pdf"), {
      params: { id: "receipt-1" },
    });

    expect(res.status).toBe(404);
    expect(advanceReceiptFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "receipt-1", buyerId: "user-1" } })
    );
  });

  it("returns a real application/pdf attachment for an owned receipt", async () => {
    advanceReceiptFindFirst.mockResolvedValue(fakeReceipt());

    const { GET } = await import("@/app/api/builder/advance/receipts/[id]/pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/advance/receipts/receipt-1/pdf"), {
      params: { id: "receipt-1" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("AR-2601-00001.pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    // A real PDF buffer always starts with the %PDF- magic bytes.
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
