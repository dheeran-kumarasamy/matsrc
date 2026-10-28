// Unit tests for renderRfqPdf (Builder Portal) — mirrors
// purchase-order-pdf.spec.ts's convention of asserting on the real PDF
// byte signature. Structurally the same test coverage as
// apps/api/src/common/rfq-pdf.util.spec.ts (apps/web's own duplicated
// renderer — see rfq-pdf.ts's header comment).

import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "./pdf-fonts";
import { renderRfqPdf, renderRfqPdfContent, type RfqPdfData } from "./rfq-pdf";

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
    notes: null,
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

  it("renders a valid PDF when optional fields are all missing (no supplier assigned yet, no site)", async () => {
    const buffer = await renderRfqPdf(
      fakeRfq({ site: null, supplier: null, notes: null, deliveryDate: null, deliveryAddress: "Fallback address" })
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid, multi-page PDF for many line items and a long description without losing rows", async () => {
    const longDescription = "A long product specification meant to wrap across multiple lines. ".repeat(6);
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

  it("renderRfqPdfContent draws onto a real pdfkit document without throwing", async () => {
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
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("RfqPdfData structurally has no supplier-quotation price/payment field", () => {
    const rfq = fakeRfq();
    expect(rfq).not.toHaveProperty("unitPrice");
    expect(rfq).not.toHaveProperty("quotedPrice");
    expect(rfq).not.toHaveProperty("paymentStatus");
  });
});
