// Unit tests for renderInvoicePdf — verifies it produces a valid PDF buffer
// both with and without invoice-level adjustments (audit fix), and never
// throws when adjustment fields are present. Mirrors the existing
// apps/supplier/lib/purchase-order-export-route.spec.ts convention of
// asserting on the real PDF byte signature rather than parsing compressed
// PDF text content.

import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfData } from "./invoice-pdf.util";

function fakeInvoice(overrides: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    invoiceNumber: "IN/2601/00001",
    invoiceDate: new Date("2026-10-01"),
    orderId: "order-1",
    enquiryId: "EQ-1",
    status: "GENERATED",
    paymentStatus: "PAID",
    currency: "INR",
    builder: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
    site: { name: "Site Office", addressLine: "45 Site Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001", gstin: null },
    shipFrom: { addressLine: null, city: null, state: "Tamil Nadu", pincode: null },
    shipTo: { addressLine: "45 Site Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
    lineItems: [
      { productName: "Cement", description: null, quantity: 10, unitPrice: 100, taxRate: 18, taxAmount: 180, subtotal: 1000, total: 1180 },
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
    ...overrides,
  };
}

describe("renderInvoicePdf", () => {
  it("renders a valid PDF with no adjustments (subtotal == taxableValue == totalAmount - tax)", async () => {
    const buffer = await renderInvoicePdf(fakeInvoice());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid PDF when freight/other-charges/discount/rounding are all non-zero", async () => {
    const buffer = await renderInvoicePdf(
      fakeInvoice({
        subtotal: 1000,
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

  it("renders a valid PDF when only a discount is applied (no freight/other/rounding)", async () => {
    const buffer = await renderInvoicePdf(
      fakeInvoice({
        subtotal: 1000,
        freightChargeAmount: 0,
        otherChargesAmount: 0,
        discountAmount: 100,
        roundingAdjustment: 0,
        taxableValue: 900,
        taxAmount: 162,
        totalAmount: 1062,
      })
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid Form GST INV-01 compliant PDF with Bill-To, HSN, UQC, tax splits and bank details", async () => {
    const buffer = await renderInvoicePdf(
      fakeInvoice({
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
        buyer: {
          legalName: "Rahul Sharma Infra Works",
          tradeName: "Sharma Constructions",
          gstin: "33AABCS1429B1ZB",
          addressLine: "12 Gandhi Road",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600001",
          stateCode: "33",
        },
        lineItems: [
          {
            slNo: 1,
            productName: "OPC 53 Cement",
            description: "50kg bag",
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
        bankDetails: {
          bankName: "ICICI Bank Ltd",
          accountName: "Triad Build Tech Private Limited",
          accountNumber: "777705678978",
          ifscCode: "ICIC0004179",
          branch: "Ganapathy branch, Coimbatore",
        },
      })
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
