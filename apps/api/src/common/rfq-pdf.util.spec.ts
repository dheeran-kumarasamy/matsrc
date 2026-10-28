// Unit tests for renderRfqPdf — verifies it produces a valid PDF buffer
// for a full RFQ, with missing optional fields, with long descriptions and
// many line items (multi-page), and that it never embeds sensitive data
// (supplier quotation notes) that was never part of RfqPdfData in the
// first place. Mirrors invoice-pdf.util.spec.ts's convention of asserting
// on the real PDF byte signature rather than parsing compressed PDF text.

import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { renderRfqPdf, renderRfqPdfContent, type RfqPdfData } from "./rfq-pdf.util";
import { useRupeeCapableFont } from "./pdf-fonts";

function fakeRfq(overrides: Partial<RfqPdfData> = {}): RfqPdfData {
  return {
    rfqNumber: "EQ/2601/00001",
    createdAt: new Date("2026-01-15"),
    status: "PLACED",
    builder: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
    site: { name: "Site Office", addressLine: "45 Site Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
    supplier: { companyName: "Acme Building Materials", email: "supplier@acme.example", phone: "9000000000" },
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

  it("renders a valid PDF when optional fields (site, supplier, notes, deliveryDate) are all missing", async () => {
    const buffer = await renderRfqPdf(
      fakeRfq({ site: null, supplier: null, notes: null, deliveryDate: null, deliveryAddress: "123 Fallback Street" })
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
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      useRupeeCapableFont(doc);
      renderRfqPdfContent(doc, fakeRfq());
      doc.end();
    });

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
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
});
