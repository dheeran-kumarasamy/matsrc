// Route-level tests for GET /api/builder/purchase-orders/[id]/export.
// Prisma and the auth context (resolveUserCtx/getOrCreateBuilder) are
// mocked; no real database/network calls. Placed under lib/ to match
// vitest.config.ts's include pattern ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus } from "@matsrc/db";

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
const purchaseOrderFindFirst = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    purchaseOrder: {
      findFirst: (...args: unknown[]) => purchaseOrderFindFirst(...args),
    },
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  resolveUserCtx: (...args: unknown[]) => resolveUserCtx(...args),
}));

function makeRequest(url: string): Request {
  return new Request(url);
}

function fakePo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "po-1",
    poNumber: "PO-2026-00001",
    status: PurchaseOrderStatus.DRAFT,
    version: 1,
    notes: null,
    termsSnapshot: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    orderId: "order-1",
    builderId: "user-1",
    supplier: { id: "sup-1", companyName: "Acme" },
    builder: { id: "user-1", name: "Builder", email: "builder@example.com" },
    lineItems: [
      {
        id: "li-1",
        productId: "prod-1",
        product: { name: "Cement", unit: "bag" },
        quantity: 10,
        unitPrice: 350,
        tax: 63,
        deliveryDate: null,
        fulfilledQuantity: 0,
      },
    ],
    order: { enquiryId: "EQ-1", status: "PLACED", siteId: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveUserCtx.mockResolvedValue({ userId: "user-1", email: "builder@example.com", name: "Builder" });
  getOrCreateBuilder.mockResolvedValue({ id: "user-1", email: "builder@example.com", name: "Builder" });
});

describe("GET /api/builder/purchase-orders/[id]/export", () => {
  it("returns 401 (not a generic 500) when the session cannot be resolved", async () => {
    // Mirrors a plain <a href> download navigation with no valid session
    // cookie — resolveUserCtx() throws "UNAUTHENTICATED" in that case (see
    // lib/builder-db.ts), which this route must map to a clean 401 exactly
    // like every other resolveUserCtx()/getUserCtx() consumer in this app.
    resolveUserCtx.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const { GET } = await import("@/app/api/builder/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://example.com/api/builder/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(401);
    expect(purchaseOrderFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the PO does not belong to the authenticated builder", async () => {
    purchaseOrderFindFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/builder/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://example.com/api/builder/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(404);
  });

  it("returns a real application/pdf attachment for ?format=pdf", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());

    const { GET } = await import("@/app/api/builder/purchase-orders/[id]/export/route");
    const res = await GET(
      makeRequest("https://example.com/api/builder/purchase-orders/po-1/export?format=pdf"),
      { params: { id: "po-1" } }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    // A real PDF buffer always starts with the %PDF- magic bytes.
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("returns the JSON export when no format is requested", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());

    const { GET } = await import("@/app/api/builder/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://example.com/api/builder/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.documentType).toBe("PURCHASE_ORDER");
    expect(data.poNumber).toBe("PO-2026-00001");
  });
});
