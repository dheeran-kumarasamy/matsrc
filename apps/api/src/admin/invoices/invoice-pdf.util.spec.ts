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
        taxAmount: 180,
        totalAmount: 1219.5,
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
});
