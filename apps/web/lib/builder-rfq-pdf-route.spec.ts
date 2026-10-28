// Route-level tests for GET /api/builder/orders/[id]/rfq-pdf. Prisma and
// the auth context (getUserCtx/getOrCreateBuilder) are mocked; no real
// database/network calls. Placed under lib/ to match vitest.config.ts's
// include pattern ("lib/**/*.spec.ts"). Mirrors
// purchase-order-export-route.spec.ts's exact structure.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserCtx = vi.fn((..._args: unknown[]) => ({
  userId: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const getOrCreateBuilder = vi.fn(async (..._args: unknown[]) => ({
  id: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const orderFindFirst = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
    },
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  getUserCtx: (...args: unknown[]) => getUserCtx(...args),
}));

function makeRequest(url: string): Request {
  return new Request(url, { headers: { "X-User-Id": "user-1", "X-User-Email": "builder@example.com" } });
}

function fakeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "order-1",
    enquiryId: "EQ/2601/00001",
    status: "PLACED",
    createdAt: new Date("2026-01-15"),
    deliveryAddress: "45 Site Road",
    deliveryDate: new Date("2026-01-25"),
    tentativeDeliveryDate: null,
    user: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
    site: null,
    items: [
      {
        quantity: 100,
        product: { name: "Cement", description: "OPC 53 Grade", unit: "BAG" },
        supplier: { companyName: "Acme", user: { email: "s@acme.example", phone: "9000000000" } },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserCtx.mockReturnValue({ userId: "user-1", email: "builder@example.com", name: "Builder" });
  getOrCreateBuilder.mockResolvedValue({ id: "user-1", email: "builder@example.com", name: "Builder" });
});

describe("GET /api/builder/orders/[id]/rfq-pdf", () => {
  it("returns 404 (not another builder's data) when the order does not belong to the authenticated builder", async () => {
    orderFindFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/builder/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(404);
    // Ownership scoping happens inside the Prisma `where` clause itself —
    // verify the lookup was actually scoped to this builder's userId, not
    // merely the raw order id.
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "order-1", userId: "user-1" }) })
    );
  });

  it("returns a real application/pdf attachment for an owned order", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder());

    const { GET } = await import("@/app/api/builder/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain('filename="RFQ-EQ-2601-00001.pdf"');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("falls back to the raw order id in the filename when enquiryId is null (legacy order)", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder({ enquiryId: null }));

    const { GET } = await import("@/app/api/builder/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain('filename="RFQ-order-1.pdf"');
  });

  it("renders a valid PDF even when no supplier has been assigned yet", async () => {
    orderFindFirst.mockResolvedValue(
      fakeOrder({ items: [{ quantity: 50, product: { name: "Bricks", description: null, unit: "PCS" }, supplier: null }] })
    );

    const { GET } = await import("@/app/api/builder/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
