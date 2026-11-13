// Server-side validation rules for order-rating receipt-copy uploads
// (/api/builder/orders/[id]/rating/receipt). Mirrors lib/payment-proof-validation.ts's
// pattern/conventions exactly, extended to also allow PDF receipts (bank-
// transfer screenshots never need PDF; receipts commonly do). Extracted into
// its own module so it can be unit-tested directly — the API route must
// never rely solely on client-side validation.
export const ALLOWED_RATING_RECEIPT_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"] as const;
export const ALLOWED_RATING_RECEIPT_EXTENSIONS = ["jpg", "jpeg", "png", "pdf"] as const;
export const MAX_RATING_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// File-signature ("magic bytes") map, keyed by MIME type, checked against the
// first bytes of the actual uploaded content — not just the client-declared
// MIME type/extension, which can both be spoofed. Practical/partial check
// (JPEG's own spec allows several valid second/third byte sequences after
// the SOI marker, so only the universally-present SOI marker is checked).
const FILE_SIGNATURES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/jpg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // "%PDF"
};

export type RatingReceiptValidationResult = { valid: true } | { valid: false; error: string };

function matchesSignature(buffer: Buffer, mimeType: string): boolean {
  const signature = FILE_SIGNATURES[mimeType];
  if (!signature) return false;
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

export function validateRatingReceiptFile(params: {
  fileName: string;
  mimeType: string;
  size: number;
  buffer?: Buffer;
}): RatingReceiptValidationResult {
  const extension = (params.fileName.split(".").pop() || "").toLowerCase();

  if (
    !ALLOWED_RATING_RECEIPT_MIME_TYPES.includes(params.mimeType as any) ||
    !ALLOWED_RATING_RECEIPT_EXTENSIONS.includes(extension as any)
  ) {
    return { valid: false, error: "Only JPG, JPEG, PNG or PDF receipts are allowed" };
  }

  // PDF extension must pair with the PDF MIME type and vice versa — prevents
  // e.g. a ".pdf" filename declared with an image/* MIME type (and the
  // reverse), which the plain allow-list checks above would not catch on
  // their own since each list is checked independently.
  const isPdfExtension = extension === "pdf";
  const isPdfMimeType = params.mimeType === "application/pdf";
  if (isPdfExtension !== isPdfMimeType) {
    return { valid: false, error: "The file extension does not match its declared file type" };
  }

  if (params.size <= 0) {
    return { valid: false, error: "The uploaded file is empty" };
  }
  if (params.size > MAX_RATING_RECEIPT_SIZE_BYTES) {
    return { valid: false, error: "The receipt file must be 5 MB or smaller" };
  }

  // File-signature check — only performed when actual bytes are supplied
  // (the API route always supplies them; unit tests exercising only the
  // metadata path may omit this for pure allow-list cases).
  if (params.buffer && !matchesSignature(params.buffer, params.mimeType)) {
    return { valid: false, error: "The uploaded file's content does not match its declared file type" };
  }

  return { valid: true };
}

// Never trust the client-provided filename for storage — generate a safe,
// predictable, collision-resistant name derived only from the orderId and
// validated extension (identical convention to
// buildSafePaymentProofFileName in lib/payment-proof-validation.ts).
export function buildSafeRatingReceiptFileName(orderId: string, fileName: string): string {
  const extension = (fileName.split(".").pop() || "").toLowerCase();
  return `rating-receipt-${orderId}.${extension}`;
}
