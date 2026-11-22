import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { renderSiteReceiptSheetPdf } from "./site-receipt-sheet-pdf";
import type { SiteReceiptSheetData } from "./site-receipt-sheet-dto";

describe("renderSiteReceiptSheetPdf (apps/web Delivery Challan)", () => {
  const sampleData: SiteReceiptSheetData = {
    documentTitle: "Delivery Challan",
    receiptSheetNumber: "DC/2608/00002",
    invoiceNumber: "IN/2608/00002",
    invoiceDate: new Date("2026-11-20"),
    generatedDate: new Date("2026-11-21"),
    supplierName: "Pioneer Steel Trading Co",
    buyerName: "Apex Infrastructure Private Limited",
    buyerAddress: "123 Anna Salai, Chennai, Tamil Nadu, 600002",
    siteName: "Coimbatore Metro Project",
    siteAddress: "Sugunapuram, Kuniyamuthur, Coimbatore, Tamil Nadu, 641008",
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

  it("2. Verifies requested layout changes and absence of removed sections", async () => {
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

      // 1. Title is "DELIVERY CHALLAN"
      expect(textRendered).toContain("DELIVERY CHALLAN");
      expect(textRendered).not.toContain("SITE MATERIAL RECEIPT & VERIFICATION SHEET");

      // 2. DC number without "Sheet No:" prefix
      expect(textRendered.some((t) => t === "DC/2608/00002")).toBe(true);
      expect(textRendered.some((t) => t.includes("Sheet No:"))).toBe(false);

      // 3. Platform header phone/email removed
      const fullText = textRendered.join(" ");
      expect(fullText).not.toContain("9487944167");
      expect(fullText).not.toContain("TRIADBUILDTECH@GMAIL.COM");

      // 4. "BUYER DETAILS" and "DELIVERY SITE DETAILS" present, "DELIVERY & REFERENCE" removed
      expect(textRendered).toContain("BUYER DETAILS");
      expect(textRendered).toContain("DELIVERY SITE DETAILS");
      expect(textRendered).not.toContain("DELIVERY & REFERENCE");
      expect(textRendered).not.toContain("BUYER / PROJECT DETAILS");

      // 5. Buyer billing address and Site address rendered; GSTIN number omitted
      expect(fullText).toContain("123 Anna Salai");
      expect(fullText).toContain("Sugunapuram, Kuniyamuthur");
      expect(fullText).not.toMatch(/\bGSTIN\b/);

      // 6. Removed sections
      expect(fullText).not.toContain("MATERIAL VERIFICATION & INSPECTION CHECKLIST");
      expect(fullText).not.toContain("All materials received as listed");
      expect(fullText).not.toContain("VERIFIED & RECEIVED BY (SITE ENGINEER)");
      expect(fullText).not.toContain("DELIVERED BY (DRIVER / TRANSPORTER)");
      expect(fullText).not.toContain("This document is intended solely for material delivery verification");

      // 7. Table headers do NOT include Recv Qty, Acc Qty, Rej Qty, Remarks
      expect(textRendered).not.toContain("Recv Qty");
      expect(textRendered).not.toContain("Acc Qty");
      expect(textRendered).not.toContain("Rej Qty");
      expect(textRendered).not.toContain("Remarks");
      expect(textRendered).toContain("Quantity");

      // 8. Strict Financial Privacy
      expect(fullText).not.toContain("₹");
      expect(fullText).not.toContain("Rs.");
      expect(fullText).not.toContain("INR");
      expect(fullText).not.toMatch(/\bunit\s*price\b/i);
      expect(fullText).not.toMatch(/\btotal\s*amount\b/i);
      expect(fullText).not.toMatch(/\bsubtotal\b/i);
    } finally {
      textSpy.mockRestore();
    }
  });

  it("3. Handles multi-page item lists spanning multiple pages seamlessly without errors", async () => {
    const longItemList = Array.from({ length: 30 }, (_, i) => ({
      slNo: i + 1,
      productName: `Construction Item Grade-${i + 1}`,
      description: `Detailed description for line item ${i + 1}`,
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
