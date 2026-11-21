import { describe, expect, it } from "vitest";
import { mapInvoiceToSiteReceiptSheet } from "./site-receipt-sheet-dto";

describe("mapInvoiceToSiteReceiptSheet (Privacy & Mapping Verification)", () => {
  const mockInvoice = {
    id: "inv-123",
    invoiceNumber: "IN/2608/00002",
    invoiceDate: new Date("2026-11-20"),
    orderId: "ord-456",
    enquiryId: "EQ/2608/00002",
    buyerPoNumber: "PO-CLIENT-99",
    status: "GENERATED",
    currency: "INR",
    subtotal: 509893.18,
    taxableValue: 509893.18,
    freightChargeAmount: 5000,
    otherChargesAmount: 1000,
    discountAmount: 2000,
    roundingAdjustment: -0.42,
    taxAmount: 2487.24,
    totalAmount: 512380.42,
    paymentStatus: "PAID",
    buyer: {
      legalName: "Apex Infrastructure Private Limited",
      tradeName: "Apex Infra",
      gstin: "33AABCA1234F1Z5",
      addressLine: "123 Anna Salai",
      city: "Chennai",
      state: "Tamil Nadu",
      pincode: "600002",
    },
    site: {
      name: "Coimbatore Metro Project",
      addressLine: "Sugunapuram, Kuniyamuthur",
      city: "Coimbatore",
      state: "Tamil Nadu",
      pincode: "641008",
    },
    supplier: {
      companyName: "Pioneer Steel Trading Co",
    },
    lineItems: [
      {
        id: "li-1",
        slNo: 1,
        productName: "TMT Fe 550D Steel Bar 12mm",
        description: "Primary ISI TMT Rebars 12m length",
        hsnCode: "7214",
        uqc: "MTR",
        unit: "MT",
        quantity: 5.5,
        unitPrice: 52000,
        subtotal: 286000,
        taxRate: 18,
        taxAmount: 51480,
        total: 337480,
        markupPercent: 3.5,
        markupAmount: 9900,
        supplierUnitPrice: 50200,
      },
      {
        id: "li-2",
        slNo: 2,
        productName: "Ultratech Cement PPC",
        description: "50kg HDPE bags",
        hsnCode: "2523",
        uqc: "BAG",
        unit: "Bags",
        quantity: 200,
        unitPrice: 385,
        subtotal: 77000,
        taxRate: 28,
        taxAmount: 21560,
        total: 98560,
        markupPercent: 2,
        markupAmount: 1540,
        supplierUnitPrice: 377,
      },
    ],
  };

  it("1. Maps invoice metadata, site, and products accurately", () => {
    const sheet = mapInvoiceToSiteReceiptSheet(mockInvoice);

    expect(sheet.documentTitle).toBe("SITE MATERIAL RECEIPT & VERIFICATION SHEET");
    expect(sheet.receiptSheetNumber).toBe("DC/2608/00002");
    expect(sheet.invoiceNumber).toBe("IN/2608/00002");
    expect(sheet.orderReference).toBe("EQ/2608/00002");
    expect(sheet.buyerPoNumber).toBe("PO-CLIENT-99");
    expect(sheet.buyerName).toBe("Apex Infrastructure Private Limited");
    expect(sheet.siteName).toBe("Coimbatore Metro Project");
    expect(sheet.deliveryAddress).toContain("Sugunapuram, Kuniyamuthur");
    expect(sheet.deliveryAddress).toContain("Coimbatore");
    expect(sheet.deliveryAddress).toContain("641008");
    expect(sheet.supplierName).toBe("Pioneer Steel Trading Co");

    expect(sheet.items).toHaveLength(2);
    expect(sheet.items[0]).toEqual({
      slNo: 1,
      productName: "TMT Fe 550D Steel Bar 12mm",
      description: "Primary ISI TMT Rebars 12m length",
      specification: "HSN: 7214",
      unit: "MTR",
      invoiceQuantity: 5.5,
    });
    expect(sheet.items[1]).toEqual({
      slNo: 2,
      productName: "Ultratech Cement PPC",
      description: "50kg HDPE bags",
      specification: "HSN: 2523",
      unit: "BAG",
      invoiceQuantity: 200,
    });
  });

  it("2. STRICT FINANCIAL PRIVACY: Excludes all financial and pricing fields from the mapped output", () => {
    const sheet = mapInvoiceToSiteReceiptSheet(mockInvoice) as any;

    // Check top-level financial fields
    const forbiddenTopLevelKeys = [
      "unitPrice",
      "rate",
      "subtotal",
      "taxableValue",
      "taxAmount",
      "totalAmount",
      "discountAmount",
      "freightChargeAmount",
      "otherChargesAmount",
      "roundingAdjustment",
      "paymentStatus",
      "amountPaid",
      "amountDue",
      "currency",
      "cgstAmount",
      "sgstAmount",
      "igstAmount",
    ];

    for (const key of forbiddenTopLevelKeys) {
      expect(sheet[key]).toBeUndefined();
    }

    // Check item-level financial fields
    const forbiddenItemKeys = [
      "unitPrice",
      "rate",
      "subtotal",
      "taxableAmount",
      "taxRate",
      "taxAmount",
      "total",
      "markupPercent",
      "markupAmount",
      "supplierUnitPrice",
      "cgstRate",
      "cgstAmount",
      "sgstRate",
      "sgstAmount",
      "igstRate",
      "igstAmount",
    ];

    for (const item of sheet.items) {
      for (const key of forbiddenItemKeys) {
        expect((item as any)[key]).toBeUndefined();
      }
    }
  });

  it("3. Handles optional and missing data gracefully with sensible fallbacks", () => {
    const minimalInvoice = {
      invoiceNumber: "IN/2608/99999",
      lineItems: [
        {
          productName: "Sand",
          quantity: "15.75",
        },
      ],
    };

    const sheet = mapInvoiceToSiteReceiptSheet(minimalInvoice);

    expect(sheet.receiptSheetNumber).toBe("DC/2608/99999");
    expect(sheet.orderReference).toBe("Not available");
    expect(sheet.buyerPoNumber).toBeNull();
    expect(sheet.buyerName).toBe("Contractor / Client");
    expect(sheet.siteName).toBe("Site not specified");
    expect(sheet.deliveryAddress).toBe("Site address not available");
    expect(sheet.supplierName).toBe("Authorized BuildOhub Supplier");

    expect(sheet.items).toHaveLength(1);
    expect(sheet.items[0]).toEqual({
      slNo: 1,
      productName: "Sand",
      description: null,
      specification: null,
      unit: "Unit",
      invoiceQuantity: 15.75,
    });
  });
});

