// Route-level tests for GET /api/builder/orders/[id]/site-receipt-sheet/pdf.
// Placed under lib/ to match vitest.config.ts's include pattern ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserCtx = vi.fn((..._args: unknown[]) => ({
  userId: "builder-user-1",
  email: "arun@builder.com",
  name: "Arun Builder",
}));

const getOrCreateBuilder = vi.fn(async (..._args: unknown[]) => ({
  id: "builder-user-1",
  name: "Arun Builder",
  email: "arun@builder.com",
}));

const orderFindFirst = vi.fn();
const invoiceFindUnique = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
    },
    invoice: {
      findUnique: (...args: unknown[]) => invoiceFindUnique(...args),
    },
  },
  getUserCtx: (...args: unknown[]) => getUserCtx(...args),
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
}));

import { GET } from "../app/api/builder/orders/[id]/site-receipt-sheet/pdf/route";

describe("GET /api/builder/orders/[id]/site-receipt-sheet/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Returns 404 if the order does not exist or does not belong to the user", async () => {
    orderFindFirst.mockResolvedValue(null);

    const req = new Request("http://localhost:3000/api/builder/orders/ord-999/site-receipt-sheet/pdf");
    const res = await GET(req, { params: { id: "ord-999" } });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Order not found");
  });

  it("2. Returns 404 if the invoice has not yet been generated for this order", async () => {
    orderFindFirst.mockResolvedValue({ id: "ord-1" });
    invoiceFindUnique.mockResolvedValue(null);

    const req = new Request("http://localhost:3000/api/builder/orders/ord-1/site-receipt-sheet/pdf");
    const res = await GET(req, { params: { id: "ord-1" } });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("No invoice has been generated for this order yet");
  });

  it("3. Returns 200 with application/pdf and proper filename header for an authorized buyer", async () => {
    orderFindFirst.mockResolvedValue({ id: "ord-1" });
    invoiceFindUnique.mockResolvedValue({
      id: "inv-1",
      invoiceNumber: "IN/2608/00002",
      invoiceDate: new Date("2026-11-20"),
      orderId: "ord-1",
      enquiryId: "EQ/2608/00002",
      buyerLegalName: "Arun Constructions",
      site: {
        name: "Metro Site",
        addressLine: "123 Main Road",
        city: "Coimbatore",
        state: "Tamil Nadu",
        pincode: "641001",
      },
      supplier: {
        companyName: "Pioneer Steel",
      },
      lineItems: [
        {
          slNo: 1,
          productName: "TMT Steel 12mm",
          quantity: "10.000",
          unit: "MT",
        },
      ],
    });

    const req = new Request("http://localhost:3000/api/builder/orders/ord-1/site-receipt-sheet/pdf");
    const res = await GET(req, { params: { id: "ord-1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain('inline; filename="DC-2608-00002.pdf"');

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
