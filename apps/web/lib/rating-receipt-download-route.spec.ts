// API-level tests for GET /api/builder/orders/[id]/rating/receipt/download —
// Rating Receipt View/Download feature. Prisma is mocked (same pattern as
// lib/advance-receipt-pdf-route.spec.ts, which also uses resolveUserCtx)
// so this runs in the existing `lib/**/*.spec.ts` vitest suite with no
// real database.
//
// Covers: authorized builder download, cross-account order-id spoofing,
// unauthenticated access, missing receipt, and safe response headers.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();
const supplierRatingFindUnique = vi.fn();

const ORDER_ID = "order-1";
const RECEIPT_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

vi.mock("@/lib/builder-db", () => {
  const prisma: any = {
    order: { findFirst: (...args: unknown[]) => orderFindFirst(...args) },
    supplierRating: { findUnique: (...args: unknown[]) => supplierRatingFindUnique(...args) },
  };

  return {
    prisma,
    getOrCreateBuilder: async (userId: string) => ({ id: userId }),
    // resolveUserCtx (not getUserCtx) — mirrors the existing
    // advance-receipt-pdf-route.spec.ts mock shape, since this route is
    // hit via a plain <a href> download link.
    resolveUserCtx: async (request: Request) => {
      const headers = request.headers;
      const userId = headers.get("X-User-Id");
      const email = headers.get("X-User-Email");
      if (!userId || !email) throw new Error("UNAUTHENTICATED");
      return { userId, email, name: headers.get("X-User-Name") || "Builder" };
    },
  };
});

function makeRequest(authHeaders = true) {
  const headers: Record<string, string> = authHeaders
    ? { "X-User-Id": "owner", "X-User-Email": "owner@example.com" }
    : {};
  return new Request(`http://localhost/api/builder/orders/${ORDER_ID}/rating/receipt/download`, {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  orderFindFirst.mockResolvedValue({ id: ORDER_ID });
  supplierRatingFindUnique.mockResolvedValue({
    receiptData: RECEIPT_BYTES,
    receiptMimeType: "image/jpeg",
    receiptFileName: `rating-receipt-${ORDER_ID}.jpg`,
  });
});

describe("GET /api/builder/orders/[id]/rating/receipt/download", () => {
  it("streams the receipt bytes to the authorized rating-owning builder with safe headers", async () => {
    const { GET } = await import("../app/api/builder/orders/[id]/rating/receipt/download/route");
    const response = await GET(makeRequest(), { params: { id: ORDER_ID } });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Disposition")).toContain(`rating-receipt-${ORDER_ID}.jpg`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(RECEIPT_BYTES)).toBe(true);
  });

  it("rejects an unauthenticated download with 401", async () => {
    const { GET } = await import("../app/api/builder/orders/[id]/rating/receipt/download/route");
    const response = await GET(makeRequest(false), { params: { id: ORDER_ID } });
    expect(response.status).toBe(401);
  });

  it("rejects an order the caller does not own — cannot download another builder's receipt by spoofing the orderId", async () => {
    orderFindFirst.mockResolvedValue(null);
    const { GET } = await import("../app/api/builder/orders/[id]/rating/receipt/download/route");
    const response = await GET(makeRequest(), { params: { id: ORDER_ID } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Order not found");
  });

  it("returns 404 when no receipt exists for the order's rating", async () => {
    supplierRatingFindUnique.mockResolvedValue({ receiptData: null, receiptMimeType: null, receiptFileName: null });
    const { GET } = await import("../app/api/builder/orders/[id]/rating/receipt/download/route");
    const response = await GET(makeRequest(), { params: { id: ORDER_ID } });
    expect(response.status).toBe(404);
  });

  it("returns 404 when no rating exists at all for the order", async () => {
    supplierRatingFindUnique.mockResolvedValue(null);
    const { GET } = await import("../app/api/builder/orders/[id]/rating/receipt/download/route");
    const response = await GET(makeRequest(), { params: { id: ORDER_ID } });
    expect(response.status).toBe(404);
  });
});
