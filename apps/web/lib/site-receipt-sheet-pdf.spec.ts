import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { renderSiteReceiptSheetPdf } from "./site-receipt-sheet-pdf";
import { mapInvoiceToSiteReceiptSheet, type SiteReceiptSheetData } from "./site-receipt-sheet-dto";

describe("renderSiteReceiptSheetPdf (apps/web)", () => {
  const sampleData: SiteReceiptSheetData = {
    documentTitle: "SITE MATERIAL RECEIPT & VERIFICATION SHEET",
    receiptSheetNumber: "DC/2608/00002",
    invoiceNumber: "IN/2608/00002",
    invoiceDate: new Date("2026-11-20"),
    generatedDate: new Date("2026-11-21"),
    supplierName: "Pioneer Steel Trading Co",
    buyerName: "Apex Infrastructure Private Limited",
    siteName: "Coimbatore Metro Project",
    deliveryAddress: "Sugunapuram, Kuniyamuthur, Coimbatore, Tamil Nadu, 641008",
    orderReference: "EQ/2608/00002",
    buyerPoNumber: "PO-7788",
    items: [
      {
        slNo: 1,
        productName: "TMT Fe 550D Rebars 12mm",
        description: "12m Primary TMT bars",
        specification: "HSN: 7214",
        unit: "MT",
        invoiceQuantity: 5.5,
      },
      {
        slNo: 2,
        productName: "Ultratech Cement 53 Grade",
        description: "50kg Bags",
        specification: "HSN: 2523",
        unit: "BAG",
        invoiceQuantity: 150,
      },
    ],
  };

  it("1. Generates a valid PDF buffer starting with %PDF-", async () => {
    const buffer = await renderSiteReceiptSheetPdf(sampleData);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("2. STRICT PRIVACY VERIFICATION: PDF document does not render financial or rate terms", async () => {
    const textRendered: string[] = [];

    // Spy on pdfkit text drawing to inspect all rendered strings
    const originalText = PDFDocument.prototype.text;
    const textSpy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (
      this: any,
      text: any,
      ...args: any[]
    ) {
      if (typeof text === "string") {
        textRendered.push(text);
      }
      return originalText.apply(this, [text, ...args] as any);
    });

    try {
      await renderSiteReceiptSheetPdf(sampleData);

      // Verify that expected verification sheet strings ARE present
      expect(textRendered).toContain("SITE MATERIAL RECEIPT & VERIFICATION SHEET");
      expect(textRendered.some((t) => t.includes(sampleData.receiptSheetNumber))).toBe(true);
      expect(textRendered).toContain("TMT Fe 550D Rebars 12mm");
      expect(textRendered).toContain("All materials received as listed");
      expect(textRendered).toContain("VERIFIED & RECEIVED BY (SITE ENGINEER)");

      // Check strictly that NO financial keywords, rupee symbols, or pricing labels appear
      const fullRenderedText = textRendered.join(" ");
      expect(fullRenderedText).not.toContain("₹");
      expect(fullRenderedText).not.toContain("Rs.");
      expect(fullRenderedText).not.toContain("INR");
      expect(fullRenderedText).not.toMatch(/\bunit\s*price\b/i);
      expect(fullRenderedText).not.toMatch(/\bitem\s*rate\b/i);
      expect(fullRenderedText).not.toMatch(/\bproduct\s*rate\b/i);
      expect(fullRenderedText).not.toMatch(/\btax\s*rate\b/i);
      expect(fullRenderedText).not.toMatch(/\bsubtotal\b/i);
      expect(fullRenderedText).not.toMatch(/\btaxable\b/i);
      expect(fullRenderedText).not.toMatch(/\bcgst\b/i);
      expect(fullRenderedText).not.toMatch(/\bsgst\b/i);
      expect(fullRenderedText).not.toMatch(/\bigst\b/i);
      expect(fullRenderedText).not.toMatch(/\bdiscount\b/i);
      expect(fullRenderedText).not.toMatch(/\bfreight\b/i);
      expect(fullRenderedText).not.toMatch(/\btotal\s*amount\b/i);
    } finally {
      textSpy.mockRestore();
    }
  });

  it("3. Handles multi-page item lists spanning multiple pages seamlessly without errors", async () => {
    const longItemList = Array.from({ length: 30 }, (_, i) => ({
      slNo: i + 1,
      productName: `Construction Item Grade-${i + 1}`,
      description: `Detailed description for line item ${i + 1} with specifications`,
      specification: `HSN: 7214-${i + 1}`,
      unit: "NOS",
      invoiceQuantity: (i + 1) * 10,
    }));

    const multiPageData: SiteReceiptSheetData = {
      ...sampleData,
      items: longItemList,
    };

    const buffer = await renderSiteReceiptSheetPdf(multiPageData);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
