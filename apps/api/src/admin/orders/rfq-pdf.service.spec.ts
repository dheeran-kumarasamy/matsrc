import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminRfqPdfService } from "./rfq-pdf.service";

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-1",
    enquiryId: "EQ/2601/00001",
    status: "PLACED",
    createdAt: new Date("2026-01-15"),
    deliveryAddress: "45 Site Road, Chennai",
    deliveryDate: new Date("2026-01-25"),
    tentativeDeliveryDate: null,
    // Order.user is still selected (and used by getSummary()'s internal
    // Admin-only display), but deliberately never reaches the rendered PDF
    // itself — see toRfqPdfData's own doc comment.
    user: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
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

function buildService(orderOverrides: Partial<any> = {}) {
  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(buildOrder(orderOverrides)),
    },
  };
  const service = new AdminRfqPdfService(prisma as any);
  return { service, prisma };
}

describe("AdminRfqPdfService", () => {
  it("throws NotFoundException when the order does not exist", async () => {
    const { service, prisma } = buildService();
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(service.renderPdf("missing-order")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("renders a valid PDF for an existing RFQ", async () => {
    const { service } = buildService();
    const { buffer, filename } = await service.renderPdf("order-1");
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(filename).toBe("RFQ-EQ-2601-00001.pdf");
  });

  it("falls back to the raw order id as the RFQ number when enquiryId is null (legacy order)", async () => {
    const { service } = buildService({ enquiryId: null });
    const { filename } = await service.renderPdf("order-1");
    expect(filename).toBe("RFQ-order-1.pdf");
  });

  it("renders a valid PDF when the order has no line items at all", async () => {
    const { service, prisma } = buildService();
    prisma.order.findUnique.mockResolvedValue(buildOrder({ items: [] }));
    const { buffer } = await service.renderPdf("order-1");
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("getSummary never includes notes (and only exposes builder identity for the internal Admin-only summary screen, never the shared PDF)", async () => {
    const { service } = buildService();
    const summary = await service.getSummary("order-1");
    expect(summary).not.toHaveProperty("notes");
    expect(summary.rfqNumber).toBe("EQ/2601/00001");
    expect(summary.itemCount).toBe(1);
  });

  // Identity privacy: the real builder name/contact details (present on
  // Order.user, loaded by loadOrder() for getSummary()'s internal Admin
  // display) must NEVER flow into the shared, cross-party PDF data object
  // — the requester is represented only by its Site name there, and the
  // counterparty is always "BuildOhub" (rendered unconditionally inside
  // rfq-pdf.util.ts, never from this service's data). Asserted directly
  // against the private mapping function's output, since the rendered PDF
  // bytes themselves are not substring-searchable (embedded TrueType
  // font — see rfq-pdf.util.spec.ts's own note on this limitation).
  it("toRfqPdfData never includes the builder's or any supplier's identity — only the Site", async () => {
    const { service, prisma } = buildService();
    const order = buildOrder({
      site: { name: "Downtown Tower Site", addressLine: "1 Site Rd", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
    });
    prisma.order.findUnique.mockResolvedValue(order);

    const data = (service as any).toRfqPdfData(order);

    expect(data).not.toHaveProperty("builder");
    expect(data).not.toHaveProperty("supplier");
    expect(data.site?.name).toBe("Downtown Tower Site");
  });
});
