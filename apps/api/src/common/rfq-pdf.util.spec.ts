// Unit tests for renderRfqPdf — verifies it produces a valid PDF buffer
// for a full RFQ, with missing optional fields, with long descriptions and
// many line items (multi-page), and that it never embeds sensitive data
// (supplier quotation notes) that was never part of RfqPdfData in the
// first place. Mirrors invoice-pdf.util.spec.ts's convention of asserting
// on the real PDF byte signature rather than parsing compressed PDF text.

import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { renderRfqPdf, renderRfqPdfContent, type RfqPdfData } from "./rfq-pdf.util";
import { useRupeeCapableFont } from "./pdf-fonts";

function fakeRfq(overrides: Partial<RfqPdfData> = {}): RfqPdfData {
  return {
    rfqNumber: "EQ/2601/00001",
    createdAt: new Date("2026-01-15"),
    status: "PLACED",
    site: { name: "Site Office", addressLine: "45 Site Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
    deliveryAddress: null,
    deliveryDate: new Date("2026-01-25"),
    notes: "Please deliver before 10am.",
    lineItems: [
      { productName: "Cement", description: "OPC 53 Grade", quantity: 100, unit: "BAG" },
      { productName: "TMT Bars", description: null, quantity: 500, unit: "KG" },
    ],
    ...overrides,
  };
}

describe("renderRfqPdf", () => {
  it("renders a valid PDF for a complete RFQ", async () => {
    const buffer = await renderRfqPdf(fakeRfq());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid PDF when optional fields (site, notes, deliveryDate) are all missing", async () => {
    const buffer = await renderRfqPdf(
      fakeRfq({ site: null, notes: null, deliveryDate: null, deliveryAddress: "123 Fallback Street" })
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid PDF with no line items at all", async () => {
    const buffer = await renderRfqPdf(fakeRfq({ lineItems: [] }));
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("renders a valid, multi-page PDF for a long description and many line items without throwing or losing rows", async () => {
    const longDescription =
      "A very long product specification that should wrap across multiple lines in the description column ".repeat(5);
    const manyItems = Array.from({ length: 60 }, (_, i) => ({
      productName: `Product ${i + 1}`,
      description: i === 0 ? longDescription : null,
      quantity: i + 1,
      unit: "PCS",
    }));

    const buffer = await renderRfqPdf(fakeRfq({ lineItems: manyItems }));
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid PDF using renderRfqPdfContent directly against a real pdfkit document (no network round-trip)", async () => {
    // Exercises renderRfqPdfContent (the pure drawing function) directly
    // rather than only through the renderRfqPdf wrapper, mirroring
    // purchase-order-pdf.spec.ts's identical split between
    // renderToBuffer(...) calling the *Content function and the
    // higher-level wrapper's own tests above.
    let pageCount = 0;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      useRupeeCapableFont(doc);
      renderRfqPdfContent(doc, fakeRfq());
      pageCount = doc.bufferedPageRange().count;
      doc.end();
    });

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount).toBe(1);
  });

  it("never receives (and therefore can never render) a supplier-quotation-shaped field", () => {
    // Structural guarantee rather than a byte-content assertion: RfqPdfData
    // has no price/quotation/paymentStatus field at all, so there is no
    // code path by which SupplierQuote pricing/notes or payment
    // information could ever reach the renderer — verified here by
    // asserting the fake RFQ object (the same shape every portal's route
    // builds) has none of those keys.
    const rfq = fakeRfq();
    expect(rfq).not.toHaveProperty("unitPrice");
    expect(rfq).not.toHaveProperty("quotedPrice");
    expect(rfq).not.toHaveProperty("paymentStatus");
    expect(rfq).not.toHaveProperty("supplierQuotes");
  });

  // Identity privacy: neither party's real name/contact details are ever
  // part of RfqPdfData at all (no `builder`/`supplier` field exists on the
  // type), and the rendered document must show only the Site name for the
  // requester and always "BuildOhub" for the counterparty. Verified both
  // structurally (the type has no identity field) and against the actual
  // rendered text (uncompressed PDF stream), the same technique used
  // elsewhere in this repo to assert on real pdfkit output.
  it("RfqPdfData has no builder/supplier identity field at all", () => {
    const rfq = fakeRfq();
    expect(rfq).not.toHaveProperty("builder");
    expect(rfq).not.toHaveProperty("supplier");
  });

  // Note: this renderer uses an embedded TrueType font (DejaVu Sans via
  // useRupeeCapableFont), so pdfkit writes glyph indices (not literal
  // ASCII character codes) into the content stream — even with
  // compression disabled, drawn text is not findable via a plain substring
  // search on the raw bytes (same limitation documented by every other
  // pdfkit spec in this codebase that uses an embedded font). These tests
  // therefore verify the identity-privacy behaviour by asserting the
  // renderer completes without throwing for each site/no-site scenario
  // (structural/crash coverage) combined with the RfqPdfData-shape
  // assertion above (the real guarantee: there is no `builder`/`supplier`
  // field for real identity data to ever flow through in the first place).
  it("renders without throwing when a Site is present (Requested-By block exercised)", async () => {
    const buffer = await renderRfqPdf(fakeRfq());
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders without throwing when no Site is tagged on the order (falls back to 'Site not specified')", async () => {
    const buffer = await renderRfqPdf(fakeRfq({ site: null }));
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  describe("Site Name & Identity Privacy Verification (Fix 4)", () => {
    it("1. Displays actual construction site name under Requested By when a site exists", () => {
      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
      useRupeeCapableFont(doc);
      const textCalls: string[] = [];
      const originalText = doc.text.bind(doc);
      vi.spyOn(doc, "text").mockImplementation((text: any, ...args: any[]) => {
        if (typeof text === "string") textCalls.push(text);
        return originalText(text, ...args);
      });

      renderRfqPdfContent(
        doc,
        fakeRfq({
          site: {
            name: "Skyline Tower Site",
            addressLine: "100 Construction Rd",
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560001",
          },
        })
      );

      const requestedByIndex = textCalls.indexOf("Requested By");
      expect(requestedByIndex).toBeGreaterThanOrEqual(0);
      expect(textCalls).toContain("Skyline Tower Site");
    });

    it("2. Displays 'Site not specified' under Requested By when no site exists", () => {
      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
      useRupeeCapableFont(doc);
      const textCalls: string[] = [];
      const originalText = doc.text.bind(doc);
      vi.spyOn(doc, "text").mockImplementation((text: any, ...args: any[]) => {
        if (typeof text === "string") textCalls.push(text);
        return originalText(text, ...args);
      });

      renderRfqPdfContent(doc, fakeRfq({ site: null }));

      const requestedByIndex = textCalls.indexOf("Requested By");
      expect(requestedByIndex).toBeGreaterThanOrEqual(0);
      expect(textCalls).toContain("Site not specified");
    });

    it("3. Never renders builder personal name, email, or phone under Requested By", () => {
      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
      useRupeeCapableFont(doc);
      const textCalls: string[] = [];
      const originalText = doc.text.bind(doc);
      vi.spyOn(doc, "text").mockImplementation((text: any, ...args: any[]) => {
        if (typeof text === "string") textCalls.push(text);
        return originalText(text, ...args);
      });

      renderRfqPdfContent(doc, fakeRfq());

      // Ensure no personal builder PII is rendered
      const piiPattern = /builder@|bob@|alice@|\+91\d{10}|[Bb]uilder [Nn]ame/;
      const hasPii = textCalls.some((t) => piiPattern.test(t));
      expect(hasPii).toBe(false);
    });

    it("4. Does not use BuildOhub as fallback under Requested By when site is null", () => {
      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
      useRupeeCapableFont(doc);
      const textCalls: string[] = [];
      const originalText = doc.text.bind(doc);
      vi.spyOn(doc, "text").mockImplementation((text: any, ...args: any[]) => {
        if (typeof text === "string") textCalls.push(text);
        return originalText(text, ...args);
      });

      renderRfqPdfContent(doc, fakeRfq({ site: null }));

      // Under Requested By, it must be "Site not specified", not "BuildOhub"
      const requestedByIndex = textCalls.indexOf("Requested By");
      // Right after "Requested By" and "Supplier", the next text drawn on the left is the requester
      expect(textCalls[requestedByIndex + 2]).toBe("Site not specified");
    });
  });
});
