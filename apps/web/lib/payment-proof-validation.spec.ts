import { describe, expect, it } from "vitest";
import {
  validatePaymentProofFile,
  buildSafePaymentProofFileName,
  MAX_PAYMENT_PROOF_SIZE_BYTES,
} from "./payment-proof-validation";

describe("validatePaymentProofFile", () => {
  it("accepts a valid JPG upload", () => {
    const result = validatePaymentProofFile({ fileName: "proof.jpg", mimeType: "image/jpeg", size: 1024 });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid JPEG upload", () => {
    const result = validatePaymentProofFile({ fileName: "proof.jpeg", mimeType: "image/jpeg", size: 1024 });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid PNG upload", () => {
    const result = validatePaymentProofFile({ fileName: "proof.png", mimeType: "image/png", size: 1024 });
    expect(result.valid).toBe(true);
  });

  it("rejects a disallowed file type (e.g. PDF)", () => {
    const result = validatePaymentProofFile({ fileName: "proof.pdf", mimeType: "application/pdf", size: 1024 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/JPG, JPEG or PNG/);
  });

  it("rejects a mismatched extension/MIME type combination", () => {
    const result = validatePaymentProofFile({ fileName: "proof.exe", mimeType: "image/jpeg", size: 1024 });
    expect(result.valid).toBe(false);
  });

  it("rejects an empty file", () => {
    const result = validatePaymentProofFile({ fileName: "proof.png", mimeType: "image/png", size: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/empty/);
  });

  it("rejects a file over the maximum size", () => {
    const result = validatePaymentProofFile({
      fileName: "proof.png",
      mimeType: "image/png",
      size: MAX_PAYMENT_PROOF_SIZE_BYTES + 1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/5 MB/);
  });

  it("accepts a file exactly at the maximum size", () => {
    const result = validatePaymentProofFile({
      fileName: "proof.png",
      mimeType: "image/png",
      size: MAX_PAYMENT_PROOF_SIZE_BYTES,
    });
    expect(result.valid).toBe(true);
  });
});

describe("buildSafePaymentProofFileName", () => {
  it("never trusts the raw client filename — derives a safe name from orderId + extension only", () => {
    const safeName = buildSafePaymentProofFileName("order-123", "../../etc/passwd.png");
    expect(safeName).toBe("payment-proof-order-123.png");
  });

  it("lowercases the extension", () => {
    const safeName = buildSafePaymentProofFileName("order-123", "screenshot.PNG");
    expect(safeName).toBe("payment-proof-order-123.png");
  });
});
