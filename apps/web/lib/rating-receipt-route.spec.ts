// API-level tests for POST/GET /api/builder/orders/[id]/rating/receipt —
// Rating Receipt Upload feature. Prisma is mocked (same pattern as
// lib/order-advance-payment-route.spec.ts) so this runs in the existing
// `lib/**/*.spec.ts` vitest suite with no real database.
//
// Covers: valid upload, missing rating, unauthenticated access, cross-
// account order-id spoofing, invalid/oversized files, replacement within
// the edit window, and rejection after the 72-hour edit window expires —
// exactly mirroring the existing rating 72-hour edit-window semantics.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();
const supplierRatingFindUnique = vi.fn();
const supplierRatingUpdate = vi.fn();

const ORDER_ID = "order-1";
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

vi.mock("@/lib/builder-db", () => {
  const prisma: any = {
    order: { findFirst: (...args: unknown[]) => orderFindFirst(...args) },
    supplierRating: {
      findUnique: (...args: unknown[]) => supplierRatingFindUnique(...args),
      update: (...args: unknown[]) => supplierRatingUpdate(...args),
    },
  };

  return {
    prisma,
    getOrCreateBuilder: async (userId: string) => ({ id: userId }),
    getUserCtx: (request: Request) => {
      const headers = request.headers;
      const userId = headers.get("X-User-Id");
      const email = headers.get("X-User-Email");
      if (!userId || !email) throw new Error("UNAUTHENTICATED");
      return { userId, email, name: headers.get("X-User-Name") || "Builder" };
    },
  };
});

function makeUploadRequest(file?: { name: string; type: string; bytes: Buffer }, authHeaders = true) {
  const headers: Record<string, string> = authHeaders
    ? { "X-User-Id": "owner", "X-User-Email": "owner@example.com" }
    : {};
  const formData = new FormData();
  if (file) {
    const blobPart = new Uint8Array(file.bytes);
    formData.append("file", new File([blobPart], file.name, { type: file.type }));
  }
  return new Request(`http://localhost/api/builder/orders/${ORDER_ID}/rating/receipt`, {
    method: "POST",
    headers,
    body: formData,
  });
}

function makeGetRequest(authHeaders = true) {
  const headers: Record<string, string> = authHeaders
    ? { "X-User-Id": "owner", "X-User-Email": "owner@example.com" }
    : {};
  return new Request(`http://localhost/api/builder/orders/${ORDER_ID}/rating/receipt`, {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  orderFindFirst.mockResolvedValue({ id: ORDER_ID, status: "DELIVERED" });
  supplierRatingFindUnique.mockResolvedValue({ id: "rating-1", createdAt: new Date() });
  supplierRatingUpdate.mockImplementation(async ({ data }: any) => ({
    orderId: ORDER_ID,
    receiptFileName: `rating-receipt-${ORDER_ID}.jpg`,
    receiptUploadedAt: data.receiptUploadedAt,
    receiptSize: data.receiptSize,
  }));
});

describe("POST /api/builder/orders/[id]/rating/receipt", () => {
  it("accepts a valid JPEG receipt for an existing rating", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: JPEG_BYTES }),
      { params: { id: ORDER_ID } }
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.fileName).toBe(`rating-receipt-${ORDER_ID}.jpg`);
    expect(supplierRatingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: ORDER_ID } })
    );
  });

  it("rejects an unauthenticated upload with 500 (getUserCtx throws, caught by the route)", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: JPEG_BYTES }, false),
      { params: { id: ORDER_ID } }
    );
    expect(response.status).toBe(500);
    expect(supplierRatingUpdate).not.toHaveBeenCalled();
  });

  it("rejects an order the caller does not own (cannot spoof another builder's orderId)", async () => {
    orderFindFirst.mockResolvedValue(null); // ownership query returns nothing for another user's order
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: JPEG_BYTES }),
      { params: { id: ORDER_ID } }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(supplierRatingUpdate).not.toHaveBeenCalled();
  });

  it("rejects a receipt upload when no rating exists yet for the order", async () => {
    supplierRatingFindUnique.mockResolvedValue(null);
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: JPEG_BYTES }),
      { params: { id: ORDER_ID } }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("RATING_NOT_FOUND");
  });

  it("rejects an unsupported file type", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.docx", type: "application/msword", bytes: Buffer.from("x") }),
      { params: { id: ORDER_ID } }
    );
    expect(response.status).toBe(400);
    expect(supplierRatingUpdate).not.toHaveBeenCalled();
  });

  it("rejects a file exceeding the 5 MB size limit", async () => {
    const oversized = Buffer.concat([JPEG_BYTES, Buffer.alloc(5 * 1024 * 1024)]);
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: oversized }),
      { params: { id: ORDER_ID } }
    );
    expect(response.status).toBe(400);
    expect(supplierRatingUpdate).not.toHaveBeenCalled();
  });

  it("rejects an order that is not yet DELIVERED", async () => {
    orderFindFirst.mockResolvedValue({ id: ORDER_ID, status: "PROCESSING" });
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: JPEG_BYTES }),
      { params: { id: ORDER_ID } }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("ORDER_NOT_DELIVERED");
  });

  it("allows replacing an existing receipt within the 72-hour edit window", async () => {
    supplierRatingFindUnique.mockResolvedValue({ id: "rating-1", createdAt: new Date(Date.now() - 60 * 60 * 1000) }); // 1h old
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: JPEG_BYTES }),
      { params: { id: ORDER_ID } }
    );
    expect(response.status).toBe(201);
    expect(supplierRatingUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects a receipt replacement after the 72-hour rating edit window has expired", async () => {
    supplierRatingFindUnique.mockResolvedValue({
      id: "rating-1",
      createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000), // 73h old
    });
    const { POST } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await POST(
      makeUploadRequest({ name: "receipt.jpg", type: "image/jpeg", bytes: JPEG_BYTES }),
      { params: { id: ORDER_ID } }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("EDIT_WINDOW_EXPIRED");
    expect(supplierRatingUpdate).not.toHaveBeenCalled();
  });
});

describe("GET /api/builder/orders/[id]/rating/receipt", () => {
  it("returns receipt metadata only — never raw bytes — for the rating submitter", async () => {
    supplierRatingFindUnique.mockResolvedValue({
      receiptFileName: `rating-receipt-${ORDER_ID}.jpg`,
      receiptUploadedAt: new Date(),
      receiptSize: 1024,
      createdAt: new Date(),
    });
    const { GET } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await GET(makeGetRequest(), { params: { id: ORDER_ID } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.fileName).toBe(`rating-receipt-${ORDER_ID}.jpg`);
    expect(body).not.toHaveProperty("receiptData");
  });

  it("returns 404 for an order the caller does not own", async () => {
    orderFindFirst.mockResolvedValue(null);
    const { GET } = await import("../app/api/builder/orders/[id]/rating/receipt/route");
    const response = await GET(makeGetRequest(), { params: { id: ORDER_ID } });
    expect(response.status).toBe(404);
  });
});
