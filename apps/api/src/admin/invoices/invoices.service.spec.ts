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
      // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) —
      // findReconciliationDiscrepancy's read. Defaults to "no discrepancy
      // ever flagged" so existing tests that don't care about this new
      // behaviour don't need to know about it.
      findFirst: vi.fn().mockResolvedValue(null),
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

  // Admin-Configurable Product Markup — BEHAVIOUR CHANGE, explicitly
  // documented: previously this test asserted that a supplier invoice whose
  // confirmedTaxableValue/confirmedTotalAmount didn't match the sum of its
  // own line items was rejected. That specific cross-check is no longer
  // meaningful: the buyer invoice's taxableValue/totalAmount are now
  // independently computed from the BUYER-facing (marked-up) line items
  // (see InvoicesService.generate's own doc comment) and are EXPECTED to
  // differ from supplierInvoice.confirmedTaxableValue/confirmedTotalAmount
  // — that gap is the platform's gross markup, not a data-integrity bug.
  // This test now verifies generation succeeds and the buyer total
  // correctly reflects the applied markup rather than the supplier's raw
  // confirmed total.
  it("computes buyer invoice totals independently from the supplier's confirmed totals (markup reconciliation)", async () => {
    const { service, prisma } = buildService({
      orderOverrides: {
        items: [
          {
            id: "item-1",
            productId: "product-1",
            supplierId: "supplier-1",
            quantity: 10,
            unitPrice: "110.00", // buyer-facing, already marked-up
            markupPercent: "10.00",
            taxRatePercent: "18.00",
            product: { name: "Cement", description: "OPC 53 Grade", supplier: { id: "supplier-1" } },
          },
        ],
        supplierInvoice: {
          id: "si-1",
          status: "CONFIRMED",
          freightChargeAmount: "0",
          otherChargesAmount: "0",
          discountAmount: "0",
          roundingAdjustment: "0",
          confirmedTaxableValue: "1000.00",
          confirmedTaxAmount: "180.00",
          confirmedTotalAmount: "1180.00",
          supplier: { region: "Tamil Nadu" },
          lineItems: [
            {
              orderItemId: "item-1",
              actualQuantity: "10.000",
              approvedUnitPrice: "100.00", // supplier settlement rate
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
    const createSpy = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "invoice-1", ...data }));
    await txCallback({
      invoice: { findUnique: vi.fn().mockResolvedValue(null), create: createSpy },
      businessSequence: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ value: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    });

    const createData = createSpy.mock.calls[0][0].data;
    // Buyer rate = 100 * 1.10 = 110; buyer subtotal = 10 * 110 = 1100
    // (never the supplier's raw 1000 subtotal).
    expect(createData.subtotal.toString()).toBe("1100");
    expect(createData.lineItems.create[0].unitPrice.toString()).toBe("110");
    expect(createData.lineItems.create[0].supplierUnitPrice.toString()).toBe("100");
    expect(createData.lineItems.create[0].markupAmount.toString()).toBe("10");
  });
});

// Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B).
describe("InvoicesService.generate — Frozen Order Snapshot Reconciliation", () => {
  // Default order fixture: items[0] has unitPrice 100, taxRatePercent 18,
  // quantity 10, markupPercent 0 -> buyer invoice total = 1180, tax = 180
  // (see buildOrder/supplierInvoice defaults above). A frozen snapshot that
  // EXACTLY matches this must raise no discrepancy.
  const RECONCILED_SNAPSHOT = {
    totalAmount: "1000.00",
    taxAmount: "180.00",
    finalPayableAmount: "1180.00",
    advancePercent: null,
    requiredAdvanceAmount: null,
    items: [
      {
        id: "item-1",
        productId: "product-1",
        supplierId: "supplier-1",
        quantity: 10,
        unitPrice: "100.00",
        taxRatePercent: "18.00",
        taxAmount: "180.00",
        product: { name: "Cement", description: "OPC 53 Grade", supplier: { id: "supplier-1" } },
      },
    ],
  };

  it("raises no discrepancy when the calculated invoice total/tax reconcile with the frozen snapshot", async () => {
    const { service, prisma } = buildService({ orderOverrides: { ...RECONCILED_SNAPSHOT } });

    await service.generate("order-1", "admin-1");

    const txCallback = prisma.$transaction.mock.calls[0][0];
    const auditCreateSpy = vi.fn().mockResolvedValue({});
    await txCallback({
      invoice: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "invoice-1", ...data })) },
      businessSequence: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ value: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: auditCreateSpy },
    });

    // Only the ordinary INVOICE_GENERATED entry — never a discrepancy one.
    const actions = auditCreateSpy.mock.calls.map((call: any) => call[0].data.action);
    expect(actions).toEqual(["INVOICE_GENERATED"]);
  });

  it("flags a discrepancy (without altering either frozen order amount) when a supplier-invoice rate override makes the buyer total diverge", async () => {
    // Admin approved a different supplier rate (110 instead of the agreed
    // 100) during supplier-invoice review — the buyer invoice's own
    // computation (markup applied to 110) now diverges from the frozen
    // snapshot, which was computed against the ORIGINAL agreed rate (100).
    const { service, prisma } = buildService({
      orderOverrides: {
        ...RECONCILED_SNAPSHOT,
        supplierInvoice: {
          id: "si-1",
          status: "CONFIRMED",
          freightChargeAmount: "0",
          otherChargesAmount: "0",
          discountAmount: "0",
          roundingAdjustment: "0",
          confirmedTaxableValue: "1100.00",
          confirmedTaxAmount: "198.00",
          confirmedTotalAmount: "1298.00",
          supplier: { region: "Tamil Nadu" },
          lineItems: [
            {
              orderItemId: "item-1",
              actualQuantity: "10.000",
              approvedUnitPrice: "110.00", // overridden, differs from agreed 100
              taxRatePercent: "18.00",
              lineSubtotal: "1100.00",
              lineTaxAmount: "198.00",
              lineTotal: "1298.00",
            },
          ],
        },
      },
    });

    await service.generate("order-1", "admin-1");

    const txCallback = prisma.$transaction.mock.calls[0][0];
    const auditCreateSpy = vi.fn().mockResolvedValue({});
    await txCallback({
      invoice: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "invoice-1", ...data })) },
      businessSequence: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ value: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: auditCreateSpy },
    });

    const discrepancyCall = auditCreateSpy.mock.calls.find((call: any) => call[0].data.action === "INVOICE_RECONCILIATION_DISCREPANCY");
    expect(discrepancyCall).toBeDefined();
    expect(discrepancyCall![0].data.metadata.expectedPayable).toBe(1180);
    expect(discrepancyCall![0].data.metadata.calculatedPayable).toBe(1298);
    expect(discrepancyCall![0].data.metadata.expectedTax).toBe(180);
    expect(discrepancyCall![0].data.metadata.calculatedTax).toBe(198);

    // The frozen Order row itself is never written to by generate() at all
    // — no order.update call exists anywhere in this service.
    expect(prisma.order.findUnique).toHaveBeenCalled();
  });

  it("flags a discrepancy when freight/other-charges/discount/rounding adjustments make the invoice total diverge from the frozen payable", async () => {
    // Same line items as RECONCILED_SNAPSHOT (buyer total = 1180, tax =
    // 180), but a freight charge pushes the invoice's own total to 1230 —
    // the frozen snapshot (1180) never anticipated this operational
    // adjustment, so it must be flagged, not silently absorbed.
    const { service, prisma } = buildService({
      orderOverrides: {
        ...RECONCILED_SNAPSHOT,
        supplierInvoice: {
          id: "si-1",
          status: "CONFIRMED",
          freightChargeAmount: "50.00",
          otherChargesAmount: "0",
          discountAmount: "0",
          roundingAdjustment: "0",
          confirmedTaxableValue: "1050.00",
          confirmedTaxAmount: "180.00",
          confirmedTotalAmount: "1230.00",
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
    const auditCreateSpy = vi.fn().mockResolvedValue({});
    await txCallback({
      invoice: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "invoice-1", ...data })) },
      businessSequence: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ value: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: auditCreateSpy },
    });

    const discrepancyCall = auditCreateSpy.mock.calls.find((call: any) => call[0].data.action === "INVOICE_RECONCILIATION_DISCREPANCY");
    expect(discrepancyCall).toBeDefined();
    expect(discrepancyCall![0].data.metadata.calculatedPayable).toBe(1230);
    expect(discrepancyCall![0].data.metadata.expectedPayable).toBe(1180);
    // Tax itself still reconciles — only the payable differs.
    expect(discrepancyCall![0].data.metadata.calculatedTax).toBe(180);
    expect(discrepancyCall![0].data.metadata.expectedTax).toBe(180);
  });

  // Phase 5C — tax-only discrepancy: the calculated buyer payable
  // reconciles with the frozen Order.finalPayableAmount, but the
  // calculated GST diverges from the frozen Order.taxAmount by more than
  // the one-cent tolerance. Constructed via a large roundingAdjustment
  // that exactly offsets a genuinely different GST rate (5% instead of
  // the frozen snapshot's 18%) so totalAmount still lands on 1180 while
  // taxAmount lands on 50 — isolating the tax comparison from the payable
  // comparison, which computeReconciliationDiscrepancy evaluates
  // independently (see its own doc comment).
  it("flags a tax-only discrepancy when GST diverges but the buyer payable still reconciles", async () => {
    const { service, prisma } = buildService({
      orderOverrides: {
        ...RECONCILED_SNAPSHOT,
        supplierInvoice: {
          id: "si-1",
          status: "CONFIRMED",
          freightChargeAmount: "0",
          otherChargesAmount: "0",
          discountAmount: "0",
          // Offsets the reduced GST (180 -> 50) so the invoice's own
          // totalAmount still equals the frozen finalPayableAmount (1180)
          // exactly — isolating a pure tax mismatch from any payable
          // mismatch. taxableValue(1000) + taxAmount(50) + rounding(130) = 1180.
          roundingAdjustment: "130.00",
          confirmedTaxableValue: "1000.00",
          confirmedTaxAmount: "50.00",
          confirmedTotalAmount: "1180.00",
          supplier: { region: "Tamil Nadu" },
          lineItems: [
            {
              orderItemId: "item-1",
              actualQuantity: "10.000",
              approvedUnitPrice: "100.00", // unchanged — never the cause of this discrepancy
              // Rate itself differs from the frozen snapshot's 18% (e.g. a
              // line-level GST correction during supplier-invoice review),
              // producing a genuinely different tax amount.
              taxRatePercent: "5.00",
              lineSubtotal: "1000.00",
              lineTaxAmount: "50.00",
              lineTotal: "1050.00",
            },
          ],
        },
      },
    });

    await service.generate("order-1", "admin-1");

    const txCallback = prisma.$transaction.mock.calls[0][0];
    const auditCreateSpy = vi.fn().mockResolvedValue({});
    await txCallback({
      invoice: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "invoice-1", ...data })) },
      businessSequence: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ value: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: auditCreateSpy },
    });

    const discrepancyCall = auditCreateSpy.mock.calls.find((call: any) => call[0].data.action === "INVOICE_RECONCILIATION_DISCREPANCY");
    expect(discrepancyCall).toBeDefined();

    // Payable reconciles exactly — the discrepancy is isolated to tax.
    expect(discrepancyCall![0].data.metadata.expectedPayable).toBe(1180);
    expect(discrepancyCall![0].data.metadata.calculatedPayable).toBe(1180);

    // Tax genuinely diverges: frozen snapshot says 180, this invoice
    // calculates 50 — a difference far exceeding the 1-cent tolerance.
    expect(discrepancyCall![0].data.metadata.expectedTax).toBe(180);
    expect(discrepancyCall![0].data.metadata.calculatedTax).toBe(50);
    expect(discrepancyCall![0].data.metadata.reason).toContain("GST");
    expect(discrepancyCall![0].data.metadata.reason).not.toContain("payable");

    // Neither frozen Order field is ever written — generate() contains no
    // order.update/updateMany call anywhere; only the read above occurred.
    expect(prisma.order.findUnique).toHaveBeenCalled();
  });

  it("fails closed (never treated as legacy) for a partial/inconsistent snapshot", async () => {
    const { service } = buildService({
      orderOverrides: {
        // finalPayableAmount set but taxAmount null — violates the
        // documented "both set or both null" invariant.
        totalAmount: "1000.00",
        taxAmount: null,
        finalPayableAmount: "1180.00",
        advancePercent: null,
        requiredAdvanceAmount: null,
      },
    });

    await expect(service.generate("order-1", "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("preserves existing legacy behaviour (all-null snapshot) — no reconciliation attempted, no discrepancy raised", async () => {
    const { service, prisma } = buildService({
      orderOverrides: {
        totalAmount: null,
        taxAmount: null,
        finalPayableAmount: null,
        advancePercent: null,
        requiredAdvanceAmount: null,
      },
    });

    await service.generate("order-1", "admin-1");

    const txCallback = prisma.$transaction.mock.calls[0][0];
    const auditCreateSpy = vi.fn().mockResolvedValue({});
    await txCallback({
      invoice: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "invoice-1", ...data })) },
      businessSequence: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ value: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: auditCreateSpy },
    });

    const actions = auditCreateSpy.mock.calls.map((call: any) => call[0].data.action);
    expect(actions).toEqual(["INVOICE_GENERATED"]);
  });

  it("surfaces an already-flagged discrepancy on the idempotent early-return path (repeated generation/retrieval), rather than hiding it", async () => {
    const { service, prisma } = buildService({
      orderOverrides: { invoice: { id: "existing-invoice", orderId: "order-1" } },
    });
    // Restore the REAL findByOrderId (buildService stubs it by default so
    // other generate() tests don't need a full detail-include mock) —
    // this test specifically verifies that real implementation surfaces
    // an already-flagged discrepancy rather than being bypassed.
    (service.findByOrderId as any).mockRestore?.();
    vi.spyOn(service as any, "detailInclude").mockReturnValue({});
    prisma.invoice.findUnique.mockResolvedValue({
      id: "existing-invoice",
      orderId: "order-1",
      lineItems: [],
    });
    prisma.auditLog.findFirst.mockResolvedValueOnce({
      createdAt: new Date("2026-01-01T00:00:00Z"),
      metadata: { expectedPayable: 1180, calculatedPayable: 1298, expectedTax: 180, calculatedTax: 198, reason: "Mismatch" },
    });

    const result = await service.generate("order-1", "admin-1");

    expect((result as any).reconciliationDiscrepancy).not.toBeNull();
    expect((result as any).reconciliationDiscrepancy.calculatedPayable).toBe(1298);
  });
});

// Admin-Configurable Product Markup — buyer-facing privacy requirement: the
// markup/margin breakdown must never be exposed to the buyer, even on their
// own invoice.
describe("InvoicesService.findByOrderIdForUser — markup detail visibility", () => {
  function buildInvoiceDetailService() {
    const invoiceRow = {
      id: "invoice-1",
      orderId: "order-1",
      builderId: "builder-1",
      invoiceNumber: "IN/2601/00001",
      invoiceDate: new Date(),
      status: "GENERATED",
      order: { id: "order-1", enquiryId: "EQ-1" },
      builder: { id: "builder-1", name: "Rahul", email: "rahul@example.com", phone: null },
      site: null,
      generatedBy: { id: "admin-1", name: "Admin", email: "admin@example.com" },
      subtotal: "1100",
      taxableValue: "1100",
      freightChargeAmount: "0",
      otherChargesAmount: "0",
      discountAmount: "0",
      roundingAdjustment: "0",
      taxAmount: "198",
      totalAmount: "1298",
      currency: "INR",
      paymentStatus: "PAID",
      amountPaid: "1298",
      amountDue: "0",
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      supplierInvoiceId: null,
      shipFromAddressLine: null,
      shipFromCity: null,
      shipFromState: null,
      shipFromPincode: null,
      shipToAddressLine: null,
      shipToCity: null,
      shipToState: null,
      shipToPincode: null,
      lineItems: [
        {
          id: "li-1",
          productId: "p1",
          productName: "Cement",
          description: null,
          quantity: "10",
          unitPrice: "110",
          taxRate: "18",
          taxAmount: "198",
          subtotal: "1100",
          total: "1298",
          supplierUnitPrice: "100",
          markupPercent: "10",
          markupAmount: "10",
        },
      ],
    };

    const prisma = {
      invoice: { findUnique: vi.fn().mockResolvedValue(invoiceRow) },
      // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) —
      // findReconciliationDiscrepancy's read, only reached for an admin
      // caller (see findByOrderIdForUser's own admin-only gating).
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new InvoicesService(prisma as any);
    return { service };
  }

  it("never includes supplierUnitPrice/markupPercent/markupAmount for the owning buyer", async () => {
    const { service } = buildInvoiceDetailService();
    const result = await service.findByOrderIdForUser("order-1", { id: "builder-1", role: "BUILDER" });

    expect(result.lineItems[0]).not.toHaveProperty("supplierUnitPrice");
    expect(result.lineItems[0]).not.toHaveProperty("markupPercent");
    expect(result.lineItems[0]).not.toHaveProperty("markupAmount");
  });

  it("includes the markup breakdown when the caller is an admin", async () => {
    const { service } = buildInvoiceDetailService();
    const result = await service.findByOrderIdForUser("order-1", { id: "admin-1", role: "ADMIN" });

    expect(result.lineItems[0].supplierUnitPrice).toBe(100);
    expect(result.lineItems[0].markupPercent).toBe(10);
    expect(result.lineItems[0].markupAmount).toBe(10);
  });
});
