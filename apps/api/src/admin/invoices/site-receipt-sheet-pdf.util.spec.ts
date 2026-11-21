import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { renderSiteReceiptSheetPdf } from "./site-receipt-sheet-pdf.util";
import { mapInvoiceToSiteReceiptSheet, type SiteReceiptSheetData } from "./site-receipt-sheet-dto";

describe("renderSiteReceiptSheetPdf (apps/api)", () => {
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
    ],
  };

  it("1. Generates a valid PDF buffer starting with %PDF-", async () => {
    const buffer = await renderSiteReceiptSheetPdf(sampleData);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("2. Verifies mapper and PDF render with no financial information", async () => {
    const textRendered: string[] = [];
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
      const fullText = textRendered.join(" ");

      expect(textRendered).toContain("SITE MATERIAL RECEIPT & VERIFICATION SHEET");
      expect(textRendered.some((t) => t.includes(sampleData.receiptSheetNumber))).toBe(true);
      expect(fullText).not.toContain("₹");
      expect(fullText).not.toContain("INR");
      expect(fullText).not.toMatch(/unit\s*price/i);
      expect(fullText).not.toMatch(/total\s*amount/i);
      expect(fullText).not.toMatch(/subtotal/i);
    } finally {
      textSpy.mockRestore();
    }
  });
});
