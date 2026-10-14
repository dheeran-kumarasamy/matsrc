import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SupplierInvoicesService } from "./supplier-invoices.service";

function buildService(overrides: Partial<any> = {}) {
  const invoice = {
    id: "si-1",
    orderId: "order-1",
    supplierId: "supplier-1",
    purchaseOrderId: null,
    status: "PENDING_REVIEW",
    fileData: Buffer.from("%PDF-1.4"),
    fileMimeType: "application/pdf",
    fileName: "supplier-invoice-order-1.pdf",
    fileSize: 8,
    supplierInvoiceNumber: "SUP/INV/001",
    supplierInvoiceDate: new Date("2026-10-01"),
    uploadedAt: new Date(),
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    confirmedAt: null,
    confirmedBy: null,
    freightChargeAmount: 0,
    otherChargesAmount: 0,
    discountAmount: 0,
    roundingAdjustment: 0,
    confirmedTaxableValue: null,
    confirmedTaxAmount: null,
    confirmedTotalAmount: null,
    hasDiscrepancy: false,
    discrepancyNotes: null,
    lineItems: [],
    order: { id: "order-1", enquiryId: "EQ-1", orderNumber: "OD/2601/00001", items: [{ id: "item-1" }] },
    supplier: { id: "supplier-1", companyName: "Acme", region: "Tamil Nadu" },
    purchaseOrder: null,
    ...overrides,
  };

  const orderItemRow = {
    id: "item-1",
    quantity: 1000,
    unitPrice: "45.00",
    taxRatePercent: "18.00",
    product: { unit: "MT", unitRef: null },
  };

  // Mutable "row state" shared across the mock's $queryRaw (lock-read) and
  // update() calls, so a test can simulate a concurrent writer committing
  // (changing this state) BETWEEN this transaction's outer pre-check and
  // its lock acquisition — exactly the interleaving the FOR UPDATE lock
  // must observe correctly.
  const rowState = { status: invoice.status as string };

  const prisma: any = {
    supplierInvoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
      findMany: vi.fn().mockResolvedValue([invoice]),
      update: vi.fn().mockImplementation(({ data }: any) => {
        if (typeof data.status === "string") {
          rowState.status = data.status;
        }
        return Promise.resolve({ ...invoice, ...data });
      }),
    },
    supplierInvoiceLineItem: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    orderItem: {
      findMany: vi.fn().mockResolvedValue([orderItemRow]),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    // Simulates `SELECT "status" FROM "SupplierInvoice" WHERE "id" = ... FOR
    // UPDATE` — returns whatever rowState.status currently holds at the
    // moment this is awaited, reflecting any concurrent writer that
    // committed first.
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve([{ status: rowState.status }])),
  };
  prisma.$transaction = vi.fn().mockImplementation((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));

  const service = new SupplierInvoicesService(prisma as any);
  return { service, prisma, invoice, orderItemRow, rowState };
}

describe("SupplierInvoicesService.reject", () => {
  it("throws NotFoundException when no invoice exists", async () => {
    const { service, prisma } = buildService();
    prisma.supplierInvoice.findUnique = vi.fn().mockResolvedValue(null);
    await expect(service.reject("missing", "admin-1", "bad scan")).rejects.toThrow(NotFoundException);
  });

  it("rejects a PENDING_REVIEW invoice and records the rejection reason", async () => {
    const { service, prisma } = buildService();
    await service.reject("si-1", "admin-1", "Illegible scan, please re-upload");
    expect(prisma.supplierInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REJECTED", rejectionReason: "Illegible scan, please re-upload" }),
      })
    );
  });

  it("refuses to reject an already-CONFIRMED invoice", async () => {
    const { service } = buildService({ status: "CONFIRMED" });
    await expect(service.reject("si-1", "admin-1", "too late")).rejects.toThrow(BadRequestException);
  });
});

describe("SupplierInvoicesService.reviewLineItems", () => {
  it("uses the agreed rate when only actual quantity differs, and flags no discrepancy", async () => {
    const { service, prisma } = buildService();
    await service.reviewLineItems("si-1", {
      lines: [{ orderItemId: "item-1", actualQuantity: 1023.5 }],
    } as any);

    const upsertCall = prisma.supplierInvoiceLineItem.upsert.mock.calls[0][0];
    expect(upsertCall.create.approvedUnitPrice).toBe(45);
    expect(upsertCall.create.rateDiscrepancy).toBe(false);

    const invoiceUpdateCall = prisma.supplierInvoice.update.mock.calls.find(
      (call: any) => call[0].data.confirmedTotalAmount !== undefined
    );
    expect(invoiceUpdateCall[0].data.hasDiscrepancy).toBe(false);
  });

  // Audit fix regression tests: unit display/validation.
  it("snapshots the order item's authoritative unit label (Product.unit) onto the reviewed line", async () => {
    const { service, prisma } = buildService();
    await service.reviewLineItems("si-1", {
      lines: [{ orderItemId: "item-1", actualQuantity: 1000 }],
    } as any);

    const upsertCall = prisma.supplierInvoiceLineItem.upsert.mock.calls[0][0];
    expect(upsertCall.create.orderUnitLabel).toBe("MT");
  });

  it("falls back to Product.unitRef.code when the deprecated free-text unit is empty", async () => {
    const { service, prisma } = buildService();
    prisma.orderItem.findMany = vi.fn().mockResolvedValue([
      { id: "item-1", quantity: 1000, unitPrice: "45.00", taxRatePercent: "18.00", product: { unit: "", unitRef: { name: "Metric Ton", code: "MT" } } },
    ]);
    await service.reviewLineItems("si-1", {
      lines: [{ orderItemId: "item-1", actualQuantity: 1000 }],
    } as any);

    const upsertCall = prisma.supplierInvoiceLineItem.upsert.mock.calls[0][0];
    expect(upsertCall.create.orderUnitLabel).toBe("MT");
  });

  it("records orderUnitLabel as null (never fabricated/inferred) when the product has no unit recorded at all", async () => {
    const { service, prisma } = buildService();
    prisma.orderItem.findMany = vi.fn().mockResolvedValue([
      { id: "item-1", quantity: 1000, unitPrice: "45.00", taxRatePercent: "18.00", product: { unit: null, unitRef: null } },
    ]);
    await service.reviewLineItems("si-1", {
      lines: [{ orderItemId: "item-1", actualQuantity: 1000 }],
    } as any);

    const upsertCall = prisma.supplierInvoiceLineItem.upsert.mock.calls[0][0];
    expect(upsertCall.create.orderUnitLabel).toBeNull();
  });

  it("defaults unitConfirmed to false when the admin has not explicitly acknowledged the unit", async () => {
    const { service, prisma } = buildService();
    await service.reviewLineItems("si-1", {
      lines: [{ orderItemId: "item-1", actualQuantity: 1000 }],
    } as any);

    const upsertCall = prisma.supplierInvoiceLineItem.upsert.mock.calls[0][0];
    expect(upsertCall.create.unitConfirmed).toBe(false);
  });

  it("persists unitConfirmed=true when the admin explicitly acknowledges the unit", async () => {
    const { service, prisma } = buildService();
    await service.reviewLineItems("si-1", {
      lines: [{ orderItemId: "item-1", actualQuantity: 1000, unitConfirmed: true }],
    } as any);

    const upsertCall = prisma.supplierInvoiceLineItem.upsert.mock.calls[0][0];
    expect(upsertCall.create.unitConfirmed).toBe(true);
  });

  it("flags a discrepancy when the supplier-invoiced rate differs from the agreed rate", async () => {
    const { service, prisma } = buildService();
    await service.reviewLineItems("si-1", {
      lines: [{ orderItemId: "item-1", actualQuantity: 1000, supplierInvoicedUnitPrice: 47 }],
    } as any);

    const upsertCall = prisma.supplierInvoiceLineItem.upsert.mock.calls[0][0];
    expect(upsertCall.create.rateDiscrepancy).toBe(true);
    // Agreed rate still used unless explicitly overridden.
    expect(upsertCall.create.approvedUnitPrice).toBe(45);

    const invoiceUpdateCall = prisma.supplierInvoice.update.mock.calls.find(
      (call: any) => call[0].data.hasDiscrepancy !== undefined
    );
    expect(invoiceUpdateCall[0].data.hasDiscrepancy).toBe(true);
  });

  it("rejects line items that do not belong to this order", async () => {
    const { service, prisma } = buildService();
    prisma.orderItem.findMany = vi.fn().mockResolvedValue([]);
    await expect(
      service.reviewLineItems("si-1", { lines: [{ orderItemId: "foreign-item", actualQuantity: 1 }] } as any)
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses to re-review an already-CONFIRMED invoice", async () => {
    const { service } = buildService({ status: "CONFIRMED" });
    await expect(
      service.reviewLineItems("si-1", { lines: [{ orderItemId: "item-1", actualQuantity: 1 }] } as any)
    ).rejects.toThrow(BadRequestException);
  });

  // Audit fix regression test: reproduces the exact interleaving that the
  // outer (pre-transaction) status check alone could not prevent — a
  // concurrent confirm() commits AFTER reviewLineItems()'s outer check
  // passes but BEFORE reviewLineItems()'s own transaction acquires its row
  // lock. The authoritative `SELECT ... FOR UPDATE` re-read inside the
  // transaction must observe the now-CONFIRMED status and reject the
  // write, never silently overwriting the confirmed snapshot.
  it("rejects the write when the invoice is confirmed by a concurrent request after the outer check but before the row lock is acquired", async () => {
    const { service, prisma, rowState } = buildService();

    // Simulate confirm() having already committed by the time THIS
    // transaction's FOR UPDATE lock is granted (e.g. it was blocked behind
    // confirm()'s own lock on the same row and only proceeds once confirm()
    // has released it) — mutate the shared row state right before the
    // lock-read resolves.
    prisma.$queryRaw.mockImplementationOnce(() => {
      rowState.status = "CONFIRMED";
      return Promise.resolve([{ status: rowState.status }]);
    });

    await expect(
      service.reviewLineItems("si-1", { lines: [{ orderItemId: "item-1", actualQuantity: 1023.5 }] } as any)
    ).rejects.toThrow(BadRequestException);

    // The confirmed snapshot must never be touched by the losing review.
    expect(prisma.supplierInvoiceLineItem.upsert).not.toHaveBeenCalled();
    expect(prisma.supplierInvoice.update).not.toHaveBeenCalled();
  });

  it("succeeds normally when no concurrent confirmation occurs (lock observes the same PENDING_REVIEW status)", async () => {
    const { service, prisma } = buildService();

    await service.reviewLineItems("si-1", { lines: [{ orderItemId: "item-1", actualQuantity: 1023.5 }] } as any);

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.supplierInvoiceLineItem.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("SupplierInvoicesService.confirm", () => {
  it("requires an ADMIN/SUPER_ADMIN actor", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique = vi.fn().mockResolvedValue({ id: "supplier-1", role: "SUPPLIER" });
    await expect(service.confirm("si-1", "supplier-1")).rejects.toThrow(ForbiddenException);
  });

  it("refuses to confirm with no reviewed line items", async () => {
    const { service } = buildService({ lineItems: [] });
    await expect(service.confirm("si-1", "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("refuses to confirm when not every order line item has been reviewed", async () => {
    const { service } = buildService({
      lineItems: [{ id: "li-1", orderItemId: "item-1", unitConfirmed: true }],
      order: { id: "order-1", enquiryId: "EQ-1", orderNumber: "OD/2601/00001", items: [{ id: "item-1" }, { id: "item-2" }] },
      confirmedTaxableValue: 45000,
      confirmedTaxAmount: 8100,
      confirmedTotalAmount: 53100,
    });
    await expect(service.confirm("si-1", "admin-1")).rejects.toThrow(BadRequestException);
  });

  // Audit fix regression test: a reviewed line with unitConfirmed left
  // false must block confirmation, even though every other requirement
  // (totals, line coverage) is satisfied.
  it("refuses to confirm when a reviewed line's unit has not been explicitly confirmed by the admin", async () => {
    const { service } = buildService({
      lineItems: [{ id: "li-1", orderItemId: "item-1", unitConfirmed: false }],
      confirmedTaxableValue: 45000,
      confirmedTaxAmount: 8100,
      confirmedTotalAmount: 53100,
    });
    await expect(service.confirm("si-1", "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("confirms a fully-reviewed invoice exactly once and writes an audit log", async () => {
    const { service, prisma } = buildService({
      lineItems: [{ id: "li-1", orderItemId: "item-1", unitConfirmed: true }],
      confirmedTaxableValue: 45000,
      confirmedTaxAmount: 8100,
      confirmedTotalAmount: 53100,
    });

    await service.confirm("si-1", "admin-1");

    expect(prisma.supplierInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONFIRMED", confirmedBy: "admin-1" }) })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "SUPPLIER_INVOICE_CONFIRMED" }) })
    );
  });

  it("is idempotent — a second confirm call on an already-CONFIRMED invoice does not re-write or duplicate", async () => {
    const { service, prisma } = buildService({ status: "CONFIRMED" });
    await service.confirm("si-1", "admin-1");
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
