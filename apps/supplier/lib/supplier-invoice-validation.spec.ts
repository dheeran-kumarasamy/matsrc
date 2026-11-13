import { describe, expect, it } from "vitest";
import {
  validateSupplierInvoiceFile,
  buildSafeSupplierInvoiceFileName,
  MAX_SUPPLIER_INVOICE_SIZE_BYTES,
} from "./supplier-invoice-validation";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_BYTES = Buffer.from("%PDF-1.4\n%mock pdf content");
const FAKE_EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ" — real Windows EXE signature

describe("validateSupplierInvoiceFile", () => {
  it("accepts a valid JPG upload with a matching signature", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.jpg",
      mimeType: "image/jpeg",
      size: JPEG_BYTES.length,
      buffer: JPEG_BYTES,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid PNG upload with a matching signature", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.png",
      mimeType: "image/png",
      size: PNG_BYTES.length,
      buffer: PNG_BYTES,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid PDF upload with a matching signature", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      size: PDF_BYTES.length,
      buffer: PDF_BYTES,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a disallowed file type (e.g. a Word document)", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.docx",
      mimeType: "application/msword",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/JPG, JPEG, PNG or PDF/);
  });

  it("rejects a mismatched extension/MIME type combination", () => {
    const result = validateSupplierInvoiceFile({ fileName: "invoice.exe", mimeType: "image/jpeg", size: 1024 });
    expect(result.valid).toBe(false);
  });

  it("rejects a PDF extension declared with an image MIME type", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.pdf",
      mimeType: "image/png",
      size: 1024,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an image extension declared with the PDF MIME type", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.png",
      mimeType: "application/pdf",
      size: 1024,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a spoofed MIME type whose actual file signature does not match (e.g. an EXE renamed to .jpg)", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.jpg",
      mimeType: "image/jpeg",
      size: FAKE_EXE_BYTES.length,
      buffer: FAKE_EXE_BYTES,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/does not match/);
  });

  it("rejects an empty file", () => {
    const result = validateSupplierInvoiceFile({ fileName: "invoice.png", mimeType: "image/png", size: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/empty/);
  });

  it("rejects a file over the maximum size", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.png",
      mimeType: "image/png",
      size: MAX_SUPPLIER_INVOICE_SIZE_BYTES + 1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/5 MB/);
  });

  it("accepts a file exactly at the maximum size (signature check skipped when no buffer supplied)", () => {
    const result = validateSupplierInvoiceFile({
      fileName: "invoice.png",
      mimeType: "image/png",
      size: MAX_SUPPLIER_INVOICE_SIZE_BYTES,
    });
    expect(result.valid).toBe(true);
  });
});

describe("buildSafeSupplierInvoiceFileName", () => {
  it("never trusts the raw client filename — derives a safe name from orderId + extension only", () => {
    const safeName = buildSafeSupplierInvoiceFileName("order-123", "../../etc/passwd.png");
    expect(safeName).toBe("supplier-invoice-order-123.png");
  });

  it("lowercases the extension", () => {
    const safeName = buildSafeSupplierInvoiceFileName("order-123", "invoice.PDF");
    expect(safeName).toBe("supplier-invoice-order-123.pdf");
  });
});
