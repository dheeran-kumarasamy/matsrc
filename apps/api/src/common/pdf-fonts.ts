import * as path from "path";

// Shared helper for every pdfkit-based PDF render util in this app
// (advance-receipt-pdf.util.ts, invoice-pdf.util.ts). pdfkit's built-in
// Standard 14 fonts (Helvetica, Times-Roman, etc.) only cover the
// WinAnsi/Latin-1 character set, which does NOT include the ₹ (Indian Rupee
// Sign, U+20B9) — pdfkit silently drops/renders nothing for any glyph the
// current font doesn't have, so every currency amount in these PDFs showed
// no rupee symbol at all.
//
// Fix: register a real embedded TrueType font (DejaVu Sans, subsetted down
// to ASCII + the handful of extra punctuation/symbol glyphs these renderers
// actually use — see apps/web/lib/pdf-fonts.ts's header comment for the
// exact subsetting command) that DOES include U+20B9, and use it as the
// document's default font for ALL text, not just the currency amounts —
// pdfkit does not support seamlessly mixing two fonts within one `.text()`
// call based on per-character glyph coverage, so switching fonts only for
// the ₹ character would require manually splitting every string around it.
// DejaVu Sans is metrically similar to Helvetica, so this does not
// noticeably change the look of the existing documents.
//
// The .ttf file is copied into dist/common/pdf-fonts/ by this package's
// `postbuild` npm script (package.json) because the swc builder NestJS is
// configured to use here does NOT run nest-cli.json's `assets` copy step
// (that only runs for the `tsc` builder) — so a plain file-copy script is
// required instead. It is also explicitly listed in apps/api/vercel.json's
// `includeFiles` glob, mirroring the pdfkit-standard-fonts fix, since
// Vercel's serverless function file-tracer does not reliably discover
// fs.readFileSync() calls with a computed path either.
const FONT_PATH = path.join(__dirname, "pdf-fonts", "DejaVuSans.ttf");

export const PDF_BASE_FONT = "PDFBaseFont";

/**
 * Registers the embedded rupee-capable font on a freshly-created
 * PDFDocument and makes it the active font, so every subsequent
 * `.text()` call (including currency strings built by a `money()`
 * helper) renders ₹ correctly instead of silently dropping the glyph.
 */
export function useRupeeCapableFont(doc: PDFKit.PDFDocument): void {
  doc.registerFont(PDF_BASE_FONT, FONT_PATH);
  doc.font(PDF_BASE_FONT);
}
