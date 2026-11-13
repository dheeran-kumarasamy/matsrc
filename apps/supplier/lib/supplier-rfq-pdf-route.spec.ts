// Route-level tests for GET /api/supplier/orders/[id]/rfq-pdf.
//
// Prisma and the auth session are mocked; no real database/network calls.
// Placed under lib/ to match vitest.config.ts's include pattern
// ("lib/**/*.spec.ts"). Mirrors purchase-order-export-route.spec.ts's exact
// structure, with the critical addition of a cross-tenant-supplier
// authorization test (an unrelated supplier must never be able to
// download this RFQ by guessing/reusing an order id).

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
  user: { email: "supplier@example.com" },
}));
const orderFindFirst = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    prisma: {
      order: {
        findFirst: (args: unknown) => orderFindFirst(args),
      },
    },
  };
});

vi.mock("@/lib/supplier-data", () => ({
  ensureSupplierContext: vi.fn(async () => ({
    supplierProfile: { id: "supplier-profile-1" },
  })),
}));

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
    items: [{ quantity: 100, product: { name: "Cement", description: "OPC 53 Grade", unit: "BAG" } }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { email: "supplier@example.com" } });
});

describe("GET /api/supplier/orders/[id]/rfq-pdf", () => {
  it("returns 401 when there is no authenticated session", async () => {
    authMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/supplier/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(401);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  // Cross-tenant-supplier authorization: a supplier whose own supplierId
  // never matches any OrderItem.supplierId on this order — i.e. an
  // unrelated/competing supplier trying to download by guessing/reusing an
  // order id — must get the same 404 any nonexistent order would, never
  // another supplier's RFQ data.
  it("returns 404 (never another supplier's data) when this order has no line item belonging to the authenticated supplier", async () => {
    orderFindFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/supplier/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(404);
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", items: { some: { supplierId: "supplier-profile-1" } } },
      })
    );
  });

  it("returns a real application/pdf attachment for an order this supplier is assigned to", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder());

    const { GET } = await import("@/app/api/supplier/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/orders/order-1/rfq-pdf"), {
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

  it("only returns this supplier's own line items (never a competing supplier's on a multi-candidate RFQ)", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder());

    const { GET } = await import("@/app/api/supplier/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(200);
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({ where: { supplierId: "supplier-profile-1" } }),
        }),
      })
    );
  });

  it("falls back to the raw order id in the filename when enquiryId is null (legacy order)", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder({ enquiryId: null }));

    const { GET } = await import("@/app/api/supplier/orders/[id]/rfq-pdf/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain('filename="RFQ-order-1.pdf"');
  });

  // Identity privacy: the Prisma query itself never selects the builder's
  // (Order.user) identity — verified directly against the query shape so a
  // future edit can't silently reintroduce it into this route. The
  // rendered document never discloses the builder's real name/contact
  // details to the requesting supplier — only the Site name.
  it("never selects the builder's identity (Order.user) from Prisma", async () => {
    orderFindFirst.mockResolvedValue(fakeOrder());

    const { GET } = await import("@/app/api/supplier/orders/[id]/rfq-pdf/route");
    await GET(makeRequest("https://supplier.example.com/api/supplier/orders/order-1/rfq-pdf"), {
      params: { id: "order-1" },
    });

    const callArgs = orderFindFirst.mock.calls[0][0];
    expect(callArgs.select).not.toHaveProperty("user");
  });
});
