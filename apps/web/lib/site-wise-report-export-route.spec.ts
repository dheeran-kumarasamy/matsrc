// Route-level tests for GET /api/builder/reports/site-wise/export.
// Prisma and the auth context (resolveUserCtx/getOrCreateBuilder) are
// mocked; no real database/network calls. Placed under lib/ to match
// vitest.config.ts's include pattern ("lib/**/*.spec.ts") — mirrors
// lib/purchase-order-export-route.spec.ts's structure for the sibling
// export route.

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
const getSiteWiseReportData = vi.fn(async (..._args: unknown[]) => ({
  summary: { totalSpend: 1000, orderCount: 1, itemCount: 1 },
  allRows: [
    {
      orderId: "order-1",
      orderDateLabel: "01 Jan 2026",
      status: "DELIVERED",
      siteName: "Site A",
      supplierName: "Acme",
      productName: "Cement",
      quantity: 10,
      unit: "bag",
      unitPrice: 350,
      taxableValue: 3500,
      taxRatePercent: 18,
      gstAmount: 630,
      total: 4130,
    },
  ],
}));

vi.mock("@/lib/builder-db", () => ({
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  resolveUserCtx: (...args: unknown[]) => resolveUserCtx(...args),
}));

vi.mock("@/lib/site-wise-report", () => ({
  getSiteWiseReportData: (...args: unknown[]) => getSiteWiseReportData(...args),
}));

function makeRequest(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveUserCtx.mockResolvedValue({ userId: "user-1", email: "builder@example.com", name: "Builder" });
  getOrCreateBuilder.mockResolvedValue({ id: "user-1", email: "builder@example.com", name: "Builder" });
  getSiteWiseReportData.mockResolvedValue({
    summary: { totalSpend: 1000, orderCount: 1, itemCount: 1 },
    allRows: [
      {
        orderId: "order-1",
        orderDateLabel: "01 Jan 2026",
        status: "DELIVERED",
        siteName: "Site A",
        supplierName: "Acme",
        productName: "Cement",
        quantity: 10,
        unit: "bag",
        unitPrice: 350,
        taxableValue: 3500,
        taxRatePercent: 18,
        gstAmount: 630,
        total: 4130,
      },
    ],
  });
});

describe("GET /api/builder/reports/site-wise/export", () => {
  it("returns 401 (not a generic 500) when the session cannot be resolved", async () => {
    // Mirrors a plain <a href> download navigation (CSV/XLSX) or
    // <a href target="_blank"> (PDF) with no valid session cookie —
    // resolveUserCtx() throws "UNAUTHENTICATED" in that case (see
    // lib/builder-db.ts), which this route must map to a clean 401 exactly
    // like every other resolveUserCtx() consumer in this app.
    resolveUserCtx.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const { GET } = await import("@/app/api/builder/reports/site-wise/export/route");
    const res = await GET(
      makeRequest("https://example.com/api/builder/reports/site-wise/export?format=pdf")
    );

    expect(res.status).toBe(401);
    expect(getSiteWiseReportData).not.toHaveBeenCalled();
  });

  it("returns a real PDF-ready HTML attachment for ?format=pdf", async () => {
    const { GET } = await import("@/app/api/builder/reports/site-wise/export/route");
    const res = await GET(
      makeRequest("https://example.com/api/builder/reports/site-wise/export?format=pdf")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns the CSV export when format=csv", async () => {
    const { GET } = await import("@/app/api/builder/reports/site-wise/export/route");
    const res = await GET(
      makeRequest("https://example.com/api/builder/reports/site-wise/export?format=csv")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });
});
