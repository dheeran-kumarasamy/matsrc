// Route-level tests for GET /api/builder/orders/[id]/rfq-pdf. Prisma and
// the auth context (resolveUserCtx/getOrCreateBuilder) are mocked; no real
// database/network calls. Placed under lib/ to match vitest.config.ts's
// include pattern ("lib/**/*.spec.ts"). Mirrors
// purchase-order-export-route.spec.ts's exact structure.
//
// Regression coverage: this route is hit via a plain <a href> browser
// download link (app/(builder)/orders/[id]/page.tsx's "Download RFQ PDF"
// button), which never attaches the custom X-User-Id/X-User-Email headers
// — only the NextAuth session cookie. The route previously used the
// header-only getUserCtx(), which throws "UNAUTHENTICATED" for every such
// click, surfacing as a generic 500 ("Failed to generate RFQ PDF") instead
// of a working download. Fixed to use resolveUserCtx() (falls back to the
// session cookie), mirroring the purchase-order export route's identical
// fix for the same bug class.

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
const orderFindFirst = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
    },
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  resolveUserCtx: (...args: unknown[]) => resolveUserCtx(...args),
}));

// No custom X-User-* headers — mirrors a real <a href> browser navigation,
// which never attaches them (only cookies). resolveUserCtx() itself is
// mocked above to resolve regardless, since its own cookie-fallback logic
// is already covered by lib/builder-db.ts's own tests; this spec only
// verifies the route calls it (not the header-only getUserCtx()) and
// handles its rejection correctly.
function makeRequest(url: string): Request {
  return new Request(url);
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
    site: null,
    items: [
      {
        quantity: 100,
        product: { name: "Cement", description: "OPC 53 Grade", unit: "BAG" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveUserCtx.mockResolvedValue({ userId: "user-1", email: "builder@example.com", name: "Builder" });
  getOrCreateBuilder.mockResolvedValue({ id: "user-1", email: "builder@example.com", name: "Builder" });
});

describe("GET /api/builder/orders/[id]/rfq-pdf", () => {
  // Regression test for the actual bug fixed here: a plain <a href> click
  // with no valid session cookie must surface as a clean 401, never the
  // generic "Failed to generate RFQ PDF" 500 the header-only getUserCtx()
  // previously produced for every single click (since a browser navigation
  // never sends the custom X-User-* headers getUserCtx() required).
  it("returns 401 (not a generic 500) when the session cannot be resolved", async () => {
    resolveUserCtx.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const { GET } = await import("@/app/api/builder/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(401);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

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

  it("renders a valid PDF even when the order has no line items", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder({ items: [] }));

    const { GET } = await import("@/app/api/builder/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://example.com/api/builder/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  // Identity privacy: the Prisma query itself never selects Order.user or
  // OrderItem.supplier — verified directly against the query shape so a
  // future edit can't silently reintroduce either field into this route.
  it("never selects the builder's (Order.user) or supplier's identity from Prisma", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder());

    const { GET } = await import("@/app/api/builder/orders/[id]/rfq-pdf/route");
    await GET(makeRequest("https://example.com/api/builder/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    const callArgs = orderFindFirst.mock.calls[0][0];
    expect(callArgs.select).not.toHaveProperty("user");
    expect(callArgs.select.items.select).not.toHaveProperty("supplier");
  });
});
