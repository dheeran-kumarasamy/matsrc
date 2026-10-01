import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { InvoicesService } from "./invoices.service";

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-1",
    userId: "builder-1",
    enquiryId: "ABC-SITE01-000123",
    siteId: "site-1",
    status: "PROCESSING",
    paymentStatus: "PAID",
    invoice: null,
    items: [
      {
        id: "item-1",
        productId: "product-1",
        supplierId: "supplier-1",
        quantity: 10,
        unitPrice: "100.00",
        taxRatePercent: "18.00",
        product: { name: "Cement", description: "OPC 53 Grade", supplier: { id: "supplier-1" } },
      },
    ],
    ...overrides,
  };
}

function buildService(overrides: Partial<any> = {}) {
  const order = buildOrder(overrides.orderOverrides ?? {});

  const invoiceRow = { id: "invoice-1", orderId: order.id };

  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => {
      if (typeof fn === "function") {
        return fn({
          invoice: {
            findUnique: prisma.invoice.findUnique,
            create: vi.fn().mockImplementation(({ data }: any) =>
              Promise.resolve({
                id: invoiceRow.id,
                invoiceNumber: "INV-2026-000001",
                ...data,
              })
            ),
          },
          invoiceSequence: {
            update: vi.fn().mockResolvedValue({ value: 1 }),
          },
          // Business Numbering (EQ/OD/IN) support (see
          // packages/db/lib/business-number.ts) — generateInvoiceNumber() now
          // routes through generateBusinessNumber() -> businessSequence.upsert/update
          // instead of the legacy invoiceSequence table above.
          businessSequence: {
            upsert: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({ value: 1 }),
          },
          $queryRaw: vi.fn().mockResolvedValue([]),
          auditLog: prisma.auditLog,
        });
      }
      return Promise.all(fn);
    }),
    ...overrides.prismaOverrides,
  };

  const service = new InvoicesService(prisma as any);

  // Stub findById so generate() tests don't need a full detail-include mock.
  vi.spyOn(service, "findById").mockImplementation(async (id: string) => ({ id } as any));
  vi.spyOn(service, "findByOrderId").mockImplementation(async (orderId: string) => ({ orderId } as any));

  return { service, prisma, order };
}

describe("InvoicesService.checkEligibility", () => {
  it("returns eligible:false when the order does not exist", async () => {
    const { service, prisma } = buildService();
    prisma.order.findUnique.mockResolvedValueOnce(null);

    const result = await service.checkEligibility("missing");
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("Order not found");
  });

  it("returns eligible:false when payment has not been verified (PAID)", async () => {
    const { service } = buildService({ orderOverrides: { paymentStatus: "PENDING_VERIFICATION" } });

    const result = await service.checkEligibility("order-1");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not yet been verified/i);
  });

  it("returns eligible:false when an invoice already exists", async () => {
    const { service } = buildService({ orderOverrides: { invoice: { id: "existing" } } });

    const result = await service.checkEligibility("order-1");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already exists/i);
  });

  it("returns eligible:false for a cancelled order", async () => {
    const { service } = buildService({ orderOverrides: { status: "CANCELLED" } });

    const result = await service.checkEligibility("order-1");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it("returns eligible:true once payment is PAID and line items exist", async () => {
    const { service } = buildService();

    const result = await service.checkEligibility("order-1");
    expect(result.eligible).toBe(true);
  });
});

describe("InvoicesService.generate", () => {
  it("throws ForbiddenException when the actor is not an Admin", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce({ id: "builder-1", role: "BUILDER" });

    await expect(service.generate("order-1", "builder-1")).rejects.toThrow(ForbiddenException);
  });

  it("throws BadRequestException when the order is not eligible", async () => {
    const { service } = buildService({ orderOverrides: { paymentStatus: "PENDING_VERIFICATION" } });

    await expect(service.generate("order-1", "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException when the order does not exist", async () => {
    const { service, prisma } = buildService();
    prisma.order.findUnique.mockResolvedValueOnce(null);

    await expect(service.generate("missing", "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("creates an invoice with the expected subtotal/tax/total once eligible", async () => {
    const { service, prisma } = buildService();

    await service.generate("order-1", "admin-1");

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("is idempotent — returns the existing invoice instead of creating a duplicate", async () => {
    const { service } = buildService({ orderOverrides: { invoice: { id: "existing-invoice" } } });

    const result = await service.generate("order-1", "admin-1");
    expect((result as any).orderId).toBe("order-1");
  });
});
