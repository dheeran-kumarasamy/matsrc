import path from "path";

// Shared helper for the supplier portal's pdfkit-based PO PDF export route
// (api/supplier/purchase-orders/[id]/export). pdfkit's built-in Standard 14
// fonts (Helvetica, Times-Roman, etc.) only cover the WinAnsi/Latin-1
// character set, which does NOT include the ₹ (Indian Rupee Sign, U+20B9) —
// pdfkit silently drops/renders nothing for any glyph the current font
// doesn't have, so every currency amount in this PDF showed no rupee
// symbol.
//
// Fix: register a real embedded TrueType font (DejaVu Sans) that DOES
// include U+20B9, and use it as the document's default font for ALL text,
// not just currency amounts — pdfkit does not support seamlessly mixing two
// fonts within one `.text()` call based on per-character glyph coverage, so
// switching fonts only for the ₹ character would require manually
// splitting every string around it. DejaVu Sans is metrically similar to
// Helvetica, so this does not noticeably change the look of the existing
// document. Byte-for-byte the same font file as apps/web's
// lib/assets/fonts/DejaVuSans.ttf (kept duplicated per-app rather than
// shared via packages/db, mirroring this route's own existing convention —
// see its header comment).
//
// lib/assets/fonts/DejaVuSans.ttf was produced from the dejavu-fonts-ttf
// npm package's DejaVuSans.ttf, subsetted with fonttools to just
// U+0020-007E (ASCII) + U+2013/U+2014 (en/em dash) + U+00B7 (middot) +
// U+20B9 (₹) — the only characters this renderer actually emits:
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
const FONT_PATH_BOLD = path.join(process.cwd(), "lib", "assets", "fonts", "DejaVuSans-Bold.ttf");

export const PDF_BASE_FONT = "PDFBaseFont";
export const PDF_BASE_FONT_BOLD = "PDFBaseFontBold";

/**
 * Registers the embedded rupee-capable font (regular + bold) on a
 * freshly-created PDFDocument and makes the regular weight the active
 * font, so every subsequent `.text()` call (including currency strings)
 * renders ₹ correctly instead of silently dropping the glyph. Use
 * `doc.font(PDF_BASE_FONT_BOLD)` for bold text (e.g. section
 * labels/headings) — pdfkit has no synthetic/faux-bold, so a real bold
 * font file must be registered and switched to explicitly.
 */
export function useRupeeCapableFont(doc: PDFKit.PDFDocument): void {
  doc.registerFont(PDF_BASE_FONT, FONT_PATH);
  doc.registerFont(PDF_BASE_FONT_BOLD, FONT_PATH_BOLD);
  doc.font(PDF_BASE_FONT);
}
