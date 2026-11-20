// Unit tests for serializeInvoice()'s financial-transparency fix (audit
// finding #2): invoice-level adjustments must be surfaced explicitly as
// their own fields, `taxableValue` must fall back to `subtotal` for
// historical rows with no adjustment fields set, and `subtotal` itself
// must never silently include any adjustment.

import { describe, expect, it } from "vitest";
import { serializeInvoice } from "./invoice-utils";

function fakeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-1",
    invoiceNumber: "IN/2601/00001",
    invoiceDate: new Date("2026-10-01"),
    status: "GENERATED",
    orderId: "order-1",
    enquiryId: "EQ-1",
    order: { enquiryId: "EQ-1" },
    builder: { id: "builder-1", name: "Rahul", email: "rahul@example.com", phone: "9123456789" },
    site: null,
    shipFromAddressLine: null,
    shipFromCity: null,
    shipFromState: "Tamil Nadu",
    shipFromPincode: null,
    shipToAddressLine: "45 Site Road",
    shipToCity: "Chennai",
    shipToState: "Tamil Nadu",
    shipToPincode: "600001",
    lineItems: [
      {
        id: "li-1",
        productId: "product-1",
        productName: "Cement",
        description: null,
        quantity: "10",
        unitPrice: "100.00",
        taxRate: "18.00",
        taxAmount: "180.00",
        subtotal: "1000.00",
        total: "1180.00",
      },
    ],
    subtotal: "1000.00",
    taxableValue: null,
    freightChargeAmount: null,
    otherChargesAmount: null,
    discountAmount: null,
    roundingAdjustment: null,
    taxAmount: "180.00",
    totalAmount: "1180.00",
    currency: "INR",
    paymentStatus: "PAID",
    amountPaid: "1180.00",
    amountDue: "0.00",
    generatedBy: { id: "admin-1", name: "Admin", email: "admin@example.com" },
    generatedAt: new Date("2026-10-01"),
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    ...overrides,
  };
}

describe("serializeInvoice financial-transparency fields", () => {
  it("falls back taxableValue to subtotal and zeroes adjustments for a historical row with no adjustment columns set", () => {
    const serialized = serializeInvoice(fakeInvoiceRow());

    expect(serialized.subtotal).toBe(1000);
    expect(serialized.taxableValue).toBe(1000);
    expect(serialized.freightChargeAmount).toBe(0);
    expect(serialized.otherChargesAmount).toBe(0);
    expect(serialized.discountAmount).toBe(0);
    expect(serialized.roundingAdjustment).toBe(0);
    expect(serialized.totalAmount).toBe(1180);
  });

  it("surfaces non-zero freight/discount/rounding explicitly, with subtotal unaffected", () => {
    const serialized = serializeInvoice(
      fakeInvoiceRow({
        taxableValue: "1040.00",
        freightChargeAmount: "50.00",
        otherChargesAmount: "10.00",
        discountAmount: "20.00",
        roundingAdjustment: "0.00",
        totalAmount: "1220.00",
      })
    );

    expect(serialized.subtotal).toBe(1000);
    expect(serialized.freightChargeAmount).toBe(50);
    expect(serialized.otherChargesAmount).toBe(10);
    expect(serialized.discountAmount).toBe(20);
    expect(serialized.roundingAdjustment).toBe(0);
    expect(serialized.taxableValue).toBe(1040);
    expect(serialized.totalAmount).toBe(1220);

    // Reconciliation: subtotal + freight + other - discount === taxableValue
    expect(
      serialized.subtotal + serialized.freightChargeAmount + serialized.otherChargesAmount - serialized.discountAmount
    ).toBe(serialized.taxableValue);

    // Reconciliation: taxableValue + tax + rounding === totalAmount
    expect(serialized.taxableValue + serialized.taxAmount + serialized.roundingAdjustment).toBe(serialized.totalAmount);
  });

  it("never includes supplier identity in the serialized output", () => {
    const serialized = serializeInvoice(fakeInvoiceRow());
    expect((serialized as any).supplier).toBeUndefined();
  });

  it("surfaces Form GST INV-01 compliant fields including intra-state CGST/SGST split and words", () => {
    const serialized = serializeInvoice(
      fakeInvoiceRow({
        placeOfSupplyStateCode: "33",
        sellerStateCode: "33",
        buyerGstin: "33AABCT1234D1Z5",
      })
    );

    expect(serialized.documentType).toBe("INV");
    expect(serialized.supplyType).toBe("B2B");
    expect(serialized.reverseCharge).toBe(false);
    expect(serialized.placeOfSupplyStateCode).toBe("33");
    expect(serialized.sellerStateCode).toBe("33");
    expect(serialized.buyer.legalName).toBe("Rahul");
    expect(serialized.buyer.gstin).toBe("33AABCT1234D1Z5");
    expect(serialized.cgstAmount).toBe(90);
    expect(serialized.sgstAmount).toBe(90);
    expect(serialized.igstAmount).toBe(0);
    expect(serialized.totalInWords).toContain("One Thousand One Hundred Eighty Only");
    expect(serialized.bankDetails).toBeDefined();

    expect(serialized.lineItems[0].hsnCode).toBe("2523");
    expect(serialized.lineItems[0].cgstRate).toBe(9);
    expect(serialized.lineItems[0].cgstAmount).toBe(90);
    expect(serialized.lineItems[0].sgstRate).toBe(9);
    expect(serialized.lineItems[0].sgstAmount).toBe(90);
  });

  it("surfaces inter-state IGST split when place of supply is outside seller state", () => {
    const serialized = serializeInvoice(
      fakeInvoiceRow({
        placeOfSupplyStateCode: "29",
        sellerStateCode: "33",
      })
    );

    expect(serialized.placeOfSupplyStateCode).toBe("29");
    expect(serialized.cgstAmount).toBe(0);
    expect(serialized.sgstAmount).toBe(0);
    expect(serialized.igstAmount).toBe(180);
    expect(serialized.lineItems[0].igstRate).toBe(18);
    expect(serialized.lineItems[0].igstAmount).toBe(180);
  });

  it("calculates paymentDueBy as 'Immediate' when paymentDueDays is 0 and paymentDueDate is null", () => {
    const serialized = serializeInvoice(
      fakeInvoiceRow({
        paymentDueDays: 0,
        paymentDueDate: null,
      })
    );
    expect(serialized.paymentDueBy).toBe("Immediate");
  });

  it("calculates paymentDueBy formatted date when paymentDueDays is positive", () => {
    const baseDate = new Date("2026-11-20T00:00:00Z");
    const serialized = serializeInvoice(
      fakeInvoiceRow({
        invoiceDate: baseDate,
        paymentDueDays: 7,
        paymentDueDate: null,
      })
    );
    expect(serialized.paymentDueBy).toBe("27/11/2026");
  });

  it("uses explicit paymentDueDate snapshot when present", () => {
    const dueDate = new Date("2026-12-05T00:00:00Z");
    const serialized = serializeInvoice(
      fakeInvoiceRow({
        paymentDueDays: 15,
        paymentDueDate: dueDate,
      })
    );
    expect(serialized.paymentDueBy).toBe("05/12/2026");
  });
});
