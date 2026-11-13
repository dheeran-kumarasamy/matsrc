// Server-side validation rules for supplier invoice uploads
// (/api/supplier/orders/[id]/invoice). Mirrors apps/web's
// lib/rating-receipt-validation.ts pattern/conventions exactly (same
// allow-list, same magic-bytes file-signature check against actual
// uploaded content, same 5 MB cap, same "never trust the client filename
// for storage" rule) — this app had no prior upload-validation module of
// its own, so this introduces the one needed for this feature rather than
// inventing a divergent set of rules.
export const ALLOWED_SUPPLIER_INVOICE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"] as const;
export const ALLOWED_SUPPLIER_INVOICE_EXTENSIONS = ["jpg", "jpeg", "png", "pdf"] as const;
export const MAX_SUPPLIER_INVOICE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const FILE_SIGNATURES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/jpg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // "%PDF"
};

export type SupplierInvoiceValidationResult = { valid: true } | { valid: false; error: string };

function matchesSignature(buffer: Buffer, mimeType: string): boolean {
  const signature = FILE_SIGNATURES[mimeType];
  if (!signature) return false;
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

export function validateSupplierInvoiceFile(params: {
  fileName: string;
  mimeType: string;
  size: number;
  buffer?: Buffer;
}): SupplierInvoiceValidationResult {
  const extension = (params.fileName.split(".").pop() || "").toLowerCase();

  if (
    !ALLOWED_SUPPLIER_INVOICE_MIME_TYPES.includes(params.mimeType as any) ||
    !ALLOWED_SUPPLIER_INVOICE_EXTENSIONS.includes(extension as any)
  ) {
    return { valid: false, error: "Only JPG, JPEG, PNG or PDF invoices are allowed" };
  }

  const isPdfExtension = extension === "pdf";
  const isPdfMimeType = params.mimeType === "application/pdf";
  if (isPdfExtension !== isPdfMimeType) {
    return { valid: false, error: "The file extension does not match its declared file type" };
  }

  if (params.size <= 0) {
    return { valid: false, error: "The uploaded file is empty" };
  }
  if (params.size > MAX_SUPPLIER_INVOICE_SIZE_BYTES) {
    return { valid: false, error: "The invoice file must be 5 MB or smaller" };
  }

  if (params.buffer && !matchesSignature(params.buffer, params.mimeType)) {
    return { valid: false, error: "The uploaded file's content does not match its declared file type" };
  }

  return { valid: true };
}

// Never trust the client-provided filename for storage — generate a safe,
// predictable, collision-resistant name derived only from the orderId and
// validated extension (identical convention to buildSafeRatingReceiptFileName).
export function buildSafeSupplierInvoiceFileName(orderId: string, fileName: string): string {
  const extension = (fileName.split(".").pop() || "").toLowerCase();
  return `supplier-invoice-${orderId}.${extension}`;
}
