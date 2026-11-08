// Route-level tests for GET /api/supplier/purchase-orders/[id]/export.
//
// Regression coverage for the bug where the supplier portal's "Download PO
// (PDF)" link pointed at a relative /api/builder/purchase-orders/[id]/export
// path — a route that only exists in apps/web (the builder portal), on a
// different domain, authorized against a completely different session. A
// supplier clicking that link got a 404 (route doesn't exist on this
// origin) or would have hit a 401 even if the path existed, since a
// supplier session can never satisfy the builder app's builderId ownership
// check. This route is the same-origin, supplier-session-authorized
// equivalent.
//
// Prisma and the auth session are mocked; no real database/network calls.
// Placed under lib/ to match vitest.config.ts's include pattern
// ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus } from "@matsrc/db";

const authMock = vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
  user: { email: "supplier@example.com" },
}));
const purchaseOrderFindFirst = vi.fn();
const checkOrderDispatchEligibilityMock = vi.fn(async (_tx?: any, _orderId?: string) => ({ eligible: false, reason: "Invoice not confirmed" }));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    checkOrderDispatchEligibility: (tx: any, orderId: string) => checkOrderDispatchEligibilityMock(tx, orderId),
    prisma: {
      purchaseOrder: {
        findFirst: (args: unknown) => purchaseOrderFindFirst(args),
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

function fakePo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "po-1",
    poNumber: "PO-2026-00001",
    status: PurchaseOrderStatus.ISSUED,
    version: 1,
    notes: null,
    approvedAt: null,
    approvedBy: null,
    orderId: "order-1",
    supplierId: "supplier-profile-1",
    supplier: { id: "supplier-profile-1", companyName: "Acme" },
    builder: { id: "user-1", name: "Builder", email: "builder@example.com" },
    lineItems: [
      {
        id: "li-1",
        product: { name: "Cement", unit: "bag" },
        quantity: 10,
        unitPrice: 350,
        tax: 63,
        deliveryDate: null,
        fulfilledQuantity: 0,
      },
    ],
    order: { enquiryId: "EQ-1", orderNumber: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { email: "supplier@example.com" } });
});

describe("GET /api/supplier/purchase-orders/[id]/export", () => {
  it("returns 401 when there is no authenticated session", async () => {
    authMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/supplier/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(401);
    expect(purchaseOrderFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the PO does not belong to the authenticated supplier (never falls through to the builder route)", async () => {
    purchaseOrderFindFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/supplier/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(404);
    expect(purchaseOrderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "po-1", supplierId: "supplier-profile-1" } })
    );
  });

  it("returns a real application/pdf attachment for ?format=pdf", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());

    const { GET } = await import("@/app/api/supplier/purchase-orders/[id]/export/route");
    const res = await GET(
      makeRequest("https://supplier.example.com/api/supplier/purchase-orders/po-1/export?format=pdf"),
      { params: { id: "po-1" } }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("returns the JSON export when no format is requested", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());

    const { GET } = await import("@/app/api/supplier/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.documentType).toBe("PURCHASE_ORDER");
    expect(data.poNumber).toBe("PO-2026-00001");
  });

  // Buyer-Facing/Supplier-Facing PO Identity fix regression guard: this
  // supplier-portal route must keep naming the download after the
  // PurchaseOrder's own poNumber — never the Order's separate orderNumber,
  // even when one has been assigned (e.g. after payment approval) — that
  // number belongs exclusively to the builder-portal's own, separately
  // rendered buyer-facing document (see apps/web's equivalent route/spec).
  it("always names the downloaded PDF after poNumber, even when the order has an orderNumber", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo({ order: { enquiryId: "EQ-1", orderNumber: "OD/2601/00042" } }));

    const { GET } = await import("@/app/api/supplier/purchase-orders/[id]/export/route");
    const res = await GET(
      makeRequest("https://supplier.example.com/api/supplier/purchase-orders/po-1/export?format=pdf"),
      { params: { id: "po-1" } }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain('filename="PO-2026-00001.pdf"');
    expect(res.headers.get("Content-Disposition")).not.toContain("OD/2601/00042");
  });

  it("withholds site name and street address and only returns site pincode when order is not ready for dispatch", async () => {
    checkOrderDispatchEligibilityMock.mockResolvedValueOnce({ eligible: false, reason: "Payment pending" });
    purchaseOrderFindFirst.mockResolvedValue(
      fakePo({
        order: {
          id: "order-1",
          status: "PROCESSING",
          enquiryId: "EQ-1",
          site: {
            name: "Secret Project Alpha",
            addressLine: "123 Construction Ave",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400001",
            gstin: "27AAAAA0000A1Z5",
          },
        },
      })
    );

    const { GET } = await import("@/app/api/supplier/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isReadyForDispatch).toBe(false);
    expect(data.deliverTo.name).toBeNull();
    expect(data.deliverTo.addressLine).toBeNull();
    expect(data.deliverTo.city).toBeNull();
    expect(data.deliverTo.state).toBeNull();
    expect(data.deliverTo.pincode).toBe("400001");
    expect(data.deliverTo.masked).toBe(true);
  });

  it("discloses full site name and address once order is ready for dispatch", async () => {
    purchaseOrderFindFirst.mockResolvedValue(
      fakePo({
        order: {
          id: "order-1",
          status: "DISPATCHED",
          enquiryId: "EQ-1",
          site: {
            name: "Secret Project Alpha",
            addressLine: "123 Construction Ave",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400001",
            gstin: "27AAAAA0000A1Z5",
          },
        },
      })
    );

    const { GET } = await import("@/app/api/supplier/purchase-orders/[id]/export/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/purchase-orders/po-1/export"), {
      params: { id: "po-1" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isReadyForDispatch).toBe(true);
    expect(data.deliverTo.name).toBe("Secret Project Alpha");
    expect(data.deliverTo.addressLine).toBe("123 Construction Ave");
    expect(data.deliverTo.city).toBe("Mumbai");
    expect(data.deliverTo.state).toBe("Maharashtra");
    expect(data.deliverTo.pincode).toBe("400001");
    expect(data.deliverTo.masked).toBe(false);
  });
});
