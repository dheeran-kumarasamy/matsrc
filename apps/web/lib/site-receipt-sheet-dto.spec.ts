import { describe, expect, it } from "vitest";
import { mapInvoiceToSiteReceiptSheet } from "./site-receipt-sheet-dto";

describe("mapInvoiceToSiteReceiptSheet (Delivery Challan Privacy & Mapping Verification)", () => {
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
      },
    ],
  };

  it("1. Maps invoice metadata, buyer details, and site delivery details accurately", () => {
    const sheet = mapInvoiceToSiteReceiptSheet(mockInvoice);

    expect(sheet.documentTitle).toBe("Delivery Challan");
    expect(sheet.receiptSheetNumber).toBe("DC/2608/00002");
    expect(sheet.invoiceNumber).toBe("IN/2608/00002");
    expect(sheet.orderReference).toBe("EQ/2608/00002");
    expect(sheet.buyerPoNumber).toBe("PO-CLIENT-99");
    expect(sheet.buyerName).toBe("Apex Infrastructure Private Limited");
    expect(sheet.buyerAddress).toContain("123 Anna Salai, Chennai, Tamil Nadu, 600002");
    expect(sheet.siteName).toBe("Coimbatore Metro Project");
    expect(sheet.siteAddress).toContain("Sugunapuram, Kuniyamuthur, Coimbatore, Tamil Nadu, 641008");

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
    expect(sheet.siteName).toBe("Site Delivery");
    expect(sheet.siteAddress).toBe("Address not configured");

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

  it("4. Filters out Freight charges, Other charges, and services from items list and numbers sequentially", () => {
    const invoiceWithCharges = {
      invoiceNumber: "IN/2608/00002",
      site: {
        name: "GK Farm House - Kovai pudhur",
        addressLine: "Near Palm Lake, OM Sakthi Nagar, Kovaipudhur",
        city: "Coimbatore",
        state: "Tamilnadu",
        pincode: "641008",
      },
      lineItems: [
        { slNo: 1, productName: "Vizag Steel 12mm TMT Bar Fe 550D", isService: false, quantity: 0.214, unit: "MT" },
        { slNo: 2, productName: "Vizag Steel 25mm TMT Bar Fe 550D", isService: false, quantity: 4.995, unit: "MT" },
        { slNo: 3, productName: "Freight charges", isService: true, quantity: 1, unit: "Trip" },
        { slNo: 4, productName: "Vizag Steel 16mm TMT Bar Fe 550D", isService: false, quantity: 1.331, unit: "MT" },
        { slNo: 5, productName: "Other charges (loading / handling)", isService: true, quantity: 1, unit: "Service" },
      ],
    };

    const sheet = mapInvoiceToSiteReceiptSheet(invoiceWithCharges);

    expect(sheet.siteName).toBe("GK Farm House - Kovai pudhur");
    expect(sheet.siteAddress).toBe("Near Palm Lake, OM Sakthi Nagar, Kovaipudhur, Coimbatore, Tamilnadu, 641008");

    // Only physical products should be present
    expect(sheet.items).toHaveLength(3);
    expect(sheet.items.map((i) => i.productName)).toEqual([
      "Vizag Steel 12mm TMT Bar Fe 550D",
      "Vizag Steel 25mm TMT Bar Fe 550D",
      "Vizag Steel 16mm TMT Bar Fe 550D",
    ]);

    // Consecutive 1-based indexing
    expect(sheet.items.map((i) => i.slNo)).toEqual([1, 2, 3]);
  });
});
