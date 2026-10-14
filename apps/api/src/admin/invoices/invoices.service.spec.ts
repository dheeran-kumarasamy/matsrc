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
    site: { addressLine: "1 Site Rd", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
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
    // Supplier Invoice Upload / Admin Verification workflow: generate()
    // now requires a CONFIRMED SupplierInvoice snapshot. Defaults to an
    // already-confirmed, fully-reconciled invoice so existing eligibility/
    // generation tests don't need to know about this new gate unless they
    // specifically override it.
    supplierInvoice: {
      id: "si-1",
      status: "CONFIRMED",
      freightChargeAmount: "0",
      otherChargesAmount: "0",
      discountAmount: "0",
      roundingAdjustment: "0",
      // confirmedTaxableValue = subtotal(1000) + freight(0) + other(0) - discount(0) = 1000
      confirmedTaxableValue: "1000.00",
      confirmedTaxAmount: "180.00",
      confirmedTotalAmount: "1180.00",
      supplier: { region: "Tamil Nadu" },
      lineItems: [
        {
          orderItemId: "item-1",
          actualQuantity: "10.000",
          approvedUnitPrice: "100.00",
          taxRatePercent: "18.00",
          lineSubtotal: "1000.00",
          lineTaxAmount: "180.00",
          lineTotal: "1180.00",
        },
      ],
    },
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

  it("returns eligible:false when no supplier invoice has been uploaded yet", async () => {
    const { service } = buildService({ orderOverrides: { supplierInvoice: null } });

    const result = await service.checkEligibility("order-1");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/has not yet uploaded/i);
  });

  it("returns eligible:false when the supplier invoice is uploaded but not yet CONFIRMED", async () => {
    const { service } = buildService({
      orderOverrides: { supplierInvoice: { id: "si-1", status: "PENDING_REVIEW", lineItems: [] } },
    });

    const result = await service.checkEligibility("order-1");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not yet been reviewed and confirmed/i);
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

  // Audit fix regression tests: freight/other-charges/discount/rounding
  // must be persisted on the generated Invoice as their own explicit
  // fields (not silently folded into `subtotal`), and `subtotal` itself
  // must equal the PURE sum of the line items — never the post-adjustment
  // confirmedTaxableValue.
  it("persists non-zero freight/discount/rounding as explicit Invoice fields, with subtotal equal to the pure line-item sum", async () => {
    const { service, prisma } = buildService({
      orderOverrides: {
        supplierInvoice: {
          id: "si-1",
          status: "CONFIRMED",
          freightChargeAmount: "50.00",
          otherChargesAmount: "10.00",
          discountAmount: "20.00",
          roundingAdjustment: "-0.50",
          // taxableValue = 1000 (line subtotal) + 50 + 10 - 20 = 1040
          confirmedTaxableValue: "1040.00",
          // tax is computed on the line items only (180), unaffected by
          // the adjustments above, consistent with
          // aggregateSupplierInvoiceTotals's documented behaviour.
          confirmedTaxAmount: "180.00",
          // total = 1040 + 180 - 0.50 = 1219.50
          confirmedTotalAmount: "1219.50",
          supplier: { region: "Tamil Nadu" },
          lineItems: [
            {
              orderItemId: "item-1",
              actualQuantity: "10.000",
              approvedUnitPrice: "100.00",
              taxRatePercent: "18.00",
              lineSubtotal: "1000.00",
              lineTaxAmount: "180.00",
              lineTotal: "1180.00",
            },
          ],
        },
      },
    });

    await service.generate("order-1", "admin-1");

    const txCallback = prisma.$transaction.mock.calls[0][0];
    expect(typeof txCallback).toBe("function");

    // Re-run the same transaction callback against a spying tx to capture
    // exactly what tx.invoice.create was called with.
    const createSpy = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "invoice-1", ...data }));
    await txCallback({
      invoice: { findUnique: vi.fn().mockResolvedValue(null), create: createSpy },
      businessSequence: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ value: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const createData = createSpy.mock.calls[0][0].data;

    // subtotal must be the PURE line-item sum (1000), never 1040.
    expect(createData.subtotal.toString()).toBe("1000");
    expect(createData.freightChargeAmount.toString()).toBe("50");
    expect(createData.otherChargesAmount.toString()).toBe("10");
    expect(createData.discountAmount.toString()).toBe("20");
    expect(createData.roundingAdjustment.toString()).toBe("-0.5");
    expect(createData.taxableValue.toString()).toBe("1040");
    expect(createData.taxAmount.toString()).toBe("180");
    expect(createData.totalAmount.toString()).toBe("1219.5");

    // Reconciliation check: subtotal + freight + other - discount === taxableValue
    const reconciledTaxable = createData.subtotal
      .plus(createData.freightChargeAmount)
      .plus(createData.otherChargesAmount)
      .minus(createData.discountAmount);
    expect(reconciledTaxable.equals(createData.taxableValue)).toBe(true);

    // Reconciliation check: taxableValue + tax + rounding === totalAmount
    const reconciledTotal = createData.taxableValue.plus(createData.taxAmount).plus(createData.roundingAdjustment);
    expect(reconciledTotal.equals(createData.totalAmount)).toBe(true);
  });

  it("rejects generation when the confirmed supplier invoice's totals do not reconcile with its own line items", async () => {
    const { service } = buildService({
      orderOverrides: {
        supplierInvoice: {
          id: "si-1",
          status: "CONFIRMED",
          freightChargeAmount: "0",
          otherChargesAmount: "0",
          discountAmount: "0",
          roundingAdjustment: "0",
          // Deliberately inconsistent: line subtotal is 1000, but
          // confirmedTaxableValue claims 5000 with no adjustments to
          // explain the gap.
          confirmedTaxableValue: "5000.00",
          confirmedTaxAmount: "180.00",
          confirmedTotalAmount: "5180.00",
          supplier: { region: "Tamil Nadu" },
          lineItems: [
            {
              orderItemId: "item-1",
              actualQuantity: "10.000",
              approvedUnitPrice: "100.00",
              taxRatePercent: "18.00",
              lineSubtotal: "1000.00",
              lineTaxAmount: "180.00",
              lineTotal: "1180.00",
            },
          ],
        },
      },
    });

    await expect(service.generate("order-1", "admin-1")).rejects.toThrow(BadRequestException);
  });
});
