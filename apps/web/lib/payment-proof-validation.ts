// Server-side validation rules for bank-transfer payment screenshot uploads
// (/api/builder/orders/[id]/payment-proof). Extracted into its own module so
// it can be unit-tested directly — the API route must never rely solely on
// client-side validation.
export const ALLOWED_PAYMENT_PROOF_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png"] as const;
export const ALLOWED_PAYMENT_PROOF_EXTENSIONS = ["jpg", "jpeg", "png"] as const;
export const MAX_PAYMENT_PROOF_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export type PaymentProofValidationResult = { valid: true } | { valid: false; error: string };

export function validatePaymentProofFile(params: {
  fileName: string;
  mimeType: string;
  size: number;
}): PaymentProofValidationResult {
  const extension = (params.fileName.split(".").pop() || "").toLowerCase();

  if (
    !ALLOWED_PAYMENT_PROOF_MIME_TYPES.includes(params.mimeType as any) ||
    !ALLOWED_PAYMENT_PROOF_EXTENSIONS.includes(extension as any)
  ) {
    return { valid: false, error: "Only JPG, JPEG or PNG payment screenshots are allowed" };
  }
  if (params.size <= 0) {
    return { valid: false, error: "The uploaded file is empty" };
  }
  if (params.size > MAX_PAYMENT_PROOF_SIZE_BYTES) {
    return { valid: false, error: "The payment screenshot must be 5 MB or smaller" };
  }
  return { valid: true };
}

// Never trust the client-provided filename for storage — generate a safe,
// predictable, collision-resistant name derived only from the orderId and
// validated extension.
export function buildSafePaymentProofFileName(orderId: string, fileName: string): string {
  const extension = (fileName.split(".").pop() || "").toLowerCase();
  return `payment-proof-${orderId}.${extension}`;
}
