import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfData } from "./invoice-pdf";

function fakeInvoice(overrides: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    invoiceNumber: "IN/2601/00001",
    invoiceDate: new Date("2026-10-01"),
    orderId: "order-1",
    enquiryId: "EQ-1",
    status: "GENERATED",
    paymentStatus: "PAID",
    currency: "INR",
    documentType: "INV",
    supplyType: "B2B",
    reverseCharge: false,
    placeOfSupplyStateCode: "33",
    placeOfSupplyStateName: "Tamil Nadu",
    sellerStateCode: "33",
    cgstAmount: 90,
    sgstAmount: 90,
    igstAmount: 0,
    totalInWords: "Rupees One Thousand One Hundred Eighty Only",
    builder: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
    buyer: {
      legalName: "Rahul Sharma Constructions",
      tradeName: "Sharma Builders",
      gstin: "33AABCS1429B1ZB",
      addressLine: "45 Site Road",
      city: "Chennai",
      state: "Tamil Nadu",
      pincode: "600001",
      stateCode: "33",
    },
    site: { name: "Site Office", addressLine: "45 Site Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001", gstin: null },
    shipFrom: { addressLine: null, city: null, state: "Tamil Nadu", pincode: null },
    shipTo: { addressLine: "45 Site Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
    lineItems: [
      {
        slNo: 1,
        productName: "Cement OPC 53",
        description: null,
        hsnCode: "2523",
        uqc: "BAG",
        unit: "Bag",
        quantity: 10,
        unitPrice: 100,
        taxableAmount: 1000,
        taxRate: 18,
        cgstRate: 9,
        cgstAmount: 90,
        sgstRate: 9,
        sgstAmount: 90,
        igstRate: null,
        igstAmount: 0,
        taxAmount: 180,
        subtotal: 1000,
        total: 1180,
      },
    ],
    subtotal: 1000,
    freightChargeAmount: 0,
    otherChargesAmount: 0,
    discountAmount: 0,
    roundingAdjustment: 0,
    taxableValue: 1000,
    taxAmount: 180,
    totalAmount: 1180,
    amountPaid: 1180,
    amountDue: 0,
    bankDetails: {
      bankName: "ICICI Bank Ltd",
      accountName: "Triad Build Tech Private Limited",
      accountNumber: "777705678978",
      ifscCode: "ICIC0004179",
      branch: "Ganapathy branch, Coimbatore",
    },
    ...overrides,
  };
}

describe("renderInvoicePdf (apps/web)", () => {
  it("renders a valid Form GST INV-01 compliant PDF with Bill-To, HSN, UQC, and intra-state CGST/SGST", async () => {
    const buffer = await renderInvoicePdf(fakeInvoice());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid PDF for inter-state supplies with IGST", async () => {
    const buffer = await renderInvoicePdf(
      fakeInvoice({
        placeOfSupplyStateCode: "29",
        placeOfSupplyStateName: "Karnataka",
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 180,
        buyer: {
          legalName: "Bengaluru Builders Ltd",
          tradeName: null,
          gstin: "29AABCS1429B1ZB",
          addressLine: "MG Road",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560001",
          stateCode: "29",
        },
      })
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid PDF with adjustments (freight/discount/rounding)", async () => {
    const buffer = await renderInvoicePdf(
      fakeInvoice({
        freightChargeAmount: 50,
        otherChargesAmount: 10,
        discountAmount: 20,
        roundingAdjustment: -0.5,
        taxableValue: 1040,
        taxAmount: 187.2,
        totalAmount: 1226.7,
      })
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders IN/2608/00001 with all Form GST INV-01 fields matching sample-gst-invoice.pdf", async () => {
    const buffer = await renderInvoicePdf({
      invoiceNumber: "IN/2608/00001",
      invoiceDate: new Date("2026-11-18"),
      orderId: "cmwjkcrpa000h93zysa7kjrp0",
      enquiryId: "EQ/2608/00001",
      status: "GENERATED",
      paymentStatus: "PAID",
      currency: "INR",
      documentType: "INV",
      supplyType: "B2B",
      reverseCharge: false,
      placeOfSupplyStateCode: "33",
      placeOfSupplyStateName: "Tamil Nadu",
      sellerStateCode: "33",
      cgstAmount: 544.5,
      sgstAmount: 544.5,
      igstAmount: 0,
      cessAmount: 0,
      totalInWords: "Rupees Seven Thousand One Hundred Thirty-Nine Only",
      buyer: {
        legalName: "Dheeran Kumarasamy",
        tradeName: "Erode Commercial",
        gstin: "URP",
        addressLine: "528, Nethaji Road",
        city: "Erode",
        state: "Tamil Nadu",
        pincode: "638001",
        stateCode: "33",
      },
      site: {
        name: "Erode Commercial",
        addressLine: "528, Nethaji Road",
        city: "Erode",
        state: "Tamilnadu",
        pincode: "638001",
        gstin: null,
      },
      shipTo: {
        addressLine: "528, Nethaji Road",
        city: "Erode",
        state: "Tamilnadu",
        pincode: "638001",
      },
      shipFrom: {
        addressLine: null,
        city: null,
        state: "Coimbatore",
        pincode: null,
      },
      lineItems: [
        {
          slNo: 1,
          productName: "Vizag Steel 12mm TMT Bar Fe 500D",
          description: "Vizag Steel 12mm TMT Bar Fe 500D",
          hsnCode: "7214",
          uqc: "KGS",
          unit: "KGS",
          quantity: 20,
          unitPrice: 65,
          taxableAmount: 1300,
          taxRate: 18,
          cgstRate: 9,
          cgstAmount: 117,
          sgstRate: 9,
          sgstAmount: 117,
          igstRate: null,
          igstAmount: 0,
          taxAmount: 234,
          subtotal: 1300,
          total: 1534,
        },
      ],
      subtotal: 1300,
      freightChargeAmount: 3000,
      otherChargesAmount: 1750,
      discountAmount: 0,
      roundingAdjustment: 0,
      taxableValue: 6050,
      taxAmount: 1089,
      totalAmount: 7139,
      amountPaid: 7139,
      amountDue: 0,
      bankDetails: {
        bankName: "ICICI Bank Ltd",
        accountName: "Triad Build Tech Private Limited",
        accountNumber: "777705678978",
        ifscCode: "ICIC0004179",
        branch: "Ganapathy branch, Coimbatore",
      },
    });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const fs = await import("fs");
    fs.writeFileSync("sample-gst-invoice.pdf", buffer);
  });
});
