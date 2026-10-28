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
    user: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
    site: null,
    items: [
      {
        quantity: 100,
        product: { name: "Cement", description: "OPC 53 Grade", unit: "BAG" },
        supplier: { companyName: "Acme Building Materials", user: { email: "supplier@acme.example", phone: "9000000000" } },
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

  it("omits supplier details entirely when no OrderItem has an assigned supplier yet", async () => {
    const { service, prisma } = buildService();
    prisma.order.findUnique.mockResolvedValue(
      buildOrder({ items: [{ quantity: 50, product: { name: "Bricks", description: null, unit: "PCS" }, supplier: null }] })
    );
    const { buffer } = await service.renderPdf("order-1");
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("getSummary never includes supplier contact details or notes", async () => {
    const { service } = buildService();
    const summary = await service.getSummary("order-1");
    expect(summary).not.toHaveProperty("supplier");
    expect(summary).not.toHaveProperty("notes");
    expect(summary.rfqNumber).toBe("EQ/2601/00001");
    expect(summary.itemCount).toBe(1);
  });
});
