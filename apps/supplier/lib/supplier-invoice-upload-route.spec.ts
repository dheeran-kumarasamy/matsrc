// Route-level tests for the supplier invoice upload workflow
// (GET/POST /api/supplier/orders/[id]/invoice). @matsrc/db and the auth
// session are mocked; no real database/network calls. Placed under lib/ to
// match vitest.config.ts's include pattern.

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn(async (): Promise<{ user: { email: string } } | null> => ({ user: { email: "supplier@example.com" } }));
const orderFindFirst = vi.fn();
const supplierInvoiceFindUnique = vi.fn();
const supplierInvoiceUpsert = vi.fn();
const supplierInvoiceLineItemDeleteMany = vi.fn();
const purchaseOrderFindFirst = vi.fn();

vi.mock("@/auth", () => ({ auth: () => authMock() }));

vi.mock("@matsrc/db", () => ({
  prisma: {
    order: { findFirst: (args: unknown) => orderFindFirst(args) },
    supplierInvoice: {
      findUnique: (args: unknown) => supplierInvoiceFindUnique(args),
      upsert: (args: unknown) => supplierInvoiceUpsert(args),
    },
    supplierInvoiceLineItem: {
      deleteMany: (args: unknown) => supplierInvoiceLineItemDeleteMany(args),
    },
    purchaseOrder: { findFirst: (args: unknown) => purchaseOrderFindFirst(args) },
    // The route wraps the stale-review-reset delete + upsert in a single
    // $transaction — mirror that here with a simple pass-through so
    // assertions can inspect the SAME upsert/deleteMany mocks above.
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        supplierInvoiceLineItem: { deleteMany: (args: unknown) => supplierInvoiceLineItemDeleteMany(args) },
        supplierInvoice: { upsert: (args: unknown) => supplierInvoiceUpsert(args) },
      }),
  },
}));

vi.mock("@/lib/supplier-data", () => ({
  ensureSupplierContext: vi.fn(async () => ({
    user: { id: "user-1" },
    supplierProfile: { id: "supplier-profile-1" },
  })),
}));

const PDF_BYTES = Buffer.from("%PDF-1.4\n%mock pdf content");

function makeUploadRequest(url: string, file: { name: string; type: string; bytes: Buffer }) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return new Request(url, { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { email: "supplier@example.com" } });
  orderFindFirst.mockResolvedValue({ id: "order-1" });
  purchaseOrderFindFirst.mockResolvedValue(null);
  supplierInvoiceLineItemDeleteMany.mockResolvedValue({ count: 0 });
});

describe("GET /api/supplier/orders/[id]/invoice", () => {
  it("returns 401 when there is no authenticated session", async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/supplier/orders/[id]/invoice/route");
    const res = await GET(new Request("https://supplier.example.com/api/supplier/orders/order-1/invoice"), {
      params: { id: "order-1" },
    });
    expect(res.status).toBe(401);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the order does not belong to this supplier", async () => {
    orderFindFirst.mockResolvedValue(null);
    const { GET } = await import("@/app/api/supplier/orders/[id]/invoice/route");
    const res = await GET(new Request("https://supplier.example.com/api/supplier/orders/order-1/invoice"), {
      params: { id: "order-1" },
    });
    expect(res.status).toBe(404);
  });

  it("returns exists:false when no invoice has been uploaded yet", async () => {
    supplierInvoiceFindUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/supplier/orders/[id]/invoice/route");
    const res = await GET(new Request("https://supplier.example.com/api/supplier/orders/order-1/invoice"), {
      params: { id: "order-1" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exists).toBe(false);
  });
});

describe("POST /api/supplier/orders/[id]/invoice", () => {
  it("rejects an upload when the existing invoice is already CONFIRMED", async () => {
    supplierInvoiceFindUnique.mockResolvedValue({ id: "si-1", status: "CONFIRMED" });
    const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
    const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
      name: "invoice.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    const res = await POST(req, { params: { id: "order-1" } });
    expect(res.status).toBe(400);
    expect(supplierInvoiceUpsert).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type", async () => {
    supplierInvoiceFindUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
    const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
      name: "invoice.docx",
      type: "application/msword",
      bytes: Buffer.from("not a real document"),
    });
    const res = await POST(req, { params: { id: "order-1" } });
    expect(res.status).toBe(400);
    expect(supplierInvoiceUpsert).not.toHaveBeenCalled();
  });

  it("uploads a valid PDF invoice and persists it as PENDING_REVIEW", async () => {
    supplierInvoiceFindUnique.mockResolvedValue(null);
    supplierInvoiceUpsert.mockResolvedValue({
      orderId: "order-1",
      status: "PENDING_REVIEW",
      fileName: "supplier-invoice-order-1.pdf",
      uploadedAt: new Date(),
      fileSize: PDF_BYTES.length,
    });

    const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
    const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
      name: "invoice.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    const res = await POST(req, { params: { id: "order-1" } });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("PENDING_REVIEW");
    expect(supplierInvoiceUpsert).toHaveBeenCalledTimes(1);
    const callArgs = supplierInvoiceUpsert.mock.calls[0][0];
    expect(callArgs.create.supplierId).toBe("supplier-profile-1");
    expect(callArgs.create.status).toBe("PENDING_REVIEW");
  });

  it("resets a REJECTED invoice back to PENDING_REVIEW on re-upload, clearing the rejection reason", async () => {
    supplierInvoiceFindUnique.mockResolvedValue({ id: "si-1", status: "REJECTED" });
    supplierInvoiceUpsert.mockResolvedValue({
      orderId: "order-1",
      status: "PENDING_REVIEW",
      fileName: "supplier-invoice-order-1.pdf",
      uploadedAt: new Date(),
      fileSize: PDF_BYTES.length,
    });

    const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
    const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
      name: "invoice.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    const res = await POST(req, { params: { id: "order-1" } });

    expect(res.status).toBe(201);
    const callArgs = supplierInvoiceUpsert.mock.calls[0][0];
    expect(callArgs.update.status).toBe("PENDING_REVIEW");
    expect(callArgs.update.rejectionReason).toBeNull();
  });

  // Audit fix regression tests: replacing a REJECTED invoice must clear
  // every trace of the discarded document's review — never let confirm()
  // later accept the new upload using figures reviewed against the old
  // file.
  describe("stale review-data reset on replacement upload (audit fix)", () => {
    it("deletes the discarded invoice's SupplierInvoiceLineItem rows when replacing a REJECTED upload", async () => {
      supplierInvoiceFindUnique.mockResolvedValue({ id: "si-1", status: "REJECTED" });
      supplierInvoiceUpsert.mockResolvedValue({
        orderId: "order-1",
        status: "PENDING_REVIEW",
        fileName: "supplier-invoice-order-1.pdf",
        uploadedAt: new Date(),
        fileSize: PDF_BYTES.length,
      });

      const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
      const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
        name: "invoice.pdf",
        type: "application/pdf",
        bytes: PDF_BYTES,
      });
      await POST(req, { params: { id: "order-1" } });

      expect(supplierInvoiceLineItemDeleteMany).toHaveBeenCalledWith({ where: { supplierInvoiceId: "si-1" } });
    });

    it("resets confirmed totals, discrepancy flags/notes and invoice-level adjustments to their defaults when replacing a REJECTED upload", async () => {
      supplierInvoiceFindUnique.mockResolvedValue({ id: "si-1", status: "REJECTED" });
      supplierInvoiceUpsert.mockResolvedValue({
        orderId: "order-1",
        status: "PENDING_REVIEW",
        fileName: "supplier-invoice-order-1.pdf",
        uploadedAt: new Date(),
        fileSize: PDF_BYTES.length,
      });

      const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
      const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
        name: "invoice.pdf",
        type: "application/pdf",
        bytes: PDF_BYTES,
      });
      await POST(req, { params: { id: "order-1" } });

      const callArgs = supplierInvoiceUpsert.mock.calls[0][0];
      expect(callArgs.update.freightChargeAmount).toBe(0);
      expect(callArgs.update.otherChargesAmount).toBe(0);
      expect(callArgs.update.discountAmount).toBe(0);
      expect(callArgs.update.roundingAdjustment).toBe(0);
      expect(callArgs.update.confirmedTaxableValue).toBeNull();
      expect(callArgs.update.confirmedTaxAmount).toBeNull();
      expect(callArgs.update.confirmedTotalAmount).toBeNull();
      expect(callArgs.update.hasDiscrepancy).toBe(false);
      expect(callArgs.update.discrepancyNotes).toBeNull();
    });

    it("never calls deleteMany for a brand-new upload with no prior invoice", async () => {
      supplierInvoiceFindUnique.mockResolvedValue(null);
      supplierInvoiceUpsert.mockResolvedValue({
        orderId: "order-1",
        status: "PENDING_REVIEW",
        fileName: "supplier-invoice-order-1.pdf",
        uploadedAt: new Date(),
        fileSize: PDF_BYTES.length,
      });

      const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
      const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
        name: "invoice.pdf",
        type: "application/pdf",
        bytes: PDF_BYTES,
      });
      await POST(req, { params: { id: "order-1" } });

      expect(supplierInvoiceLineItemDeleteMany).not.toHaveBeenCalled();
    });

    it("still refuses to replace a CONFIRMED invoice (and never deletes its line items)", async () => {
      supplierInvoiceFindUnique.mockResolvedValue({ id: "si-1", status: "CONFIRMED" });

      const { POST } = await import("@/app/api/supplier/orders/[id]/invoice/route");
      const req = makeUploadRequest("https://supplier.example.com/api/supplier/orders/order-1/invoice", {
        name: "invoice.pdf",
        type: "application/pdf",
        bytes: PDF_BYTES,
      });
      const res = await POST(req, { params: { id: "order-1" } });

      expect(res.status).toBe(400);
      expect(supplierInvoiceLineItemDeleteMany).not.toHaveBeenCalled();
      expect(supplierInvoiceUpsert).not.toHaveBeenCalled();
    });
  });
});
