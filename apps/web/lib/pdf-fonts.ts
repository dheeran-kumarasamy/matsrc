import path from "path";

// Shared helper for every pdfkit-based PDF render route in this app
// (purchase-orders/[id]/export, orders/[id]/invoice/pdf,
// advance/receipts/[id]/pdf). pdfkit's built-in Standard 14 fonts
// (Helvetica, Times-Roman, etc.) only cover the WinAnsi/Latin-1 character
// set, which does NOT include the ₹ (Indian Rupee Sign, U+20B9) — pdfkit
// silently drops/renders nothing for any glyph the current font doesn't
// have, so every currency amount in these PDFs showed no rupee symbol.
//
// Fix: register a real embedded TrueType font (DejaVu Sans) that DOES
// include U+20B9, and use it as the document's default font for ALL text,
// not just currency amounts — pdfkit does not support seamlessly mixing two
// fonts within one `.text()` call based on per-character glyph coverage, so
// switching fonts only for the ₹ character would require manually
// splitting every string around it. DejaVu Sans is metrically similar to
// Helvetica, so this does not noticeably change the look of the existing
// documents.
//
// lib/assets/fonts/DejaVuSans.ttf was produced from the dejavu-fonts-ttf
// npm package's DejaVuSans.ttf, subsetted with fonttools to just
// U+0020-007E (ASCII) + U+2013/U+2014 (en/em dash) + U+00B7 (middot) +
// U+20B9 (₹) — the only characters these renderers actually emit — to keep
// the bundled file small (~26KB vs ~750KB for the full font):
//   fonttools subset DejaVuSans.ttf \
//     --unicodes="U+0020-007E,U+2013,U+2014,U+00B7,U+20B9" \
//     --output-file=DejaVuSans.ttf
//
// Explicitly listed in next.config.js's outputFileTracingIncludes because
// Next's output-file-tracer does not reliably discover a
// fs.readFileSync(path.join(process.cwd(), ...)) call with a computed path
// (same class of gap as the pdfkit standard-fonts asset issue it already
// works around).
const FONT_PATH = path.join(process.cwd(), "lib", "assets", "fonts", "DejaVuSans.ttf");

export const PDF_BASE_FONT = "PDFBaseFont";

/**
 * Registers the embedded rupee-capable font on a freshly-created
 * PDFDocument and makes it the active font, so every subsequent `.text()`
 * call (including currency strings built by a `money()` helper) renders ₹
 * correctly instead of silently dropping the glyph.
 */
export function useRupeeCapableFont(doc: PDFKit.PDFDocument): void {
  doc.registerFont(PDF_BASE_FONT, FONT_PATH);
  doc.font(PDF_BASE_FONT);
}
