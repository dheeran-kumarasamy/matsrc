import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAX_RATE_PERCENT,
  aggregateQuotationTotals,
  calculateLineGst,
  calculateLineTaxSplit,
  getStateCode,
  getStateName,
  isValidQuotedPrice,
  normalizeUqc,
  resolveInvoiceDisplayUnit,
  numberToIndianWords,
  parseQuotedPrice,
  roundCurrency,
} from "./gst-calculation";

describe("calculateLineGst", () => {
  // Test 1 — Supplier can edit price
  it("computes the line subtotal from the supplier-entered unit price", () => {
    const result = calculateLineGst({ quantity: 100, unitPrice: 425, gstRatePercent: 0 });
    expect(result.lineSubtotal).toBe(42500);
  });

  // Test 2 — GST calculation
  it("computes subtotal, GST and total for a single line item", () => {
    const result = calculateLineGst({ quantity: 100, unitPrice: 425, gstRatePercent: 18 });
    expect(result.lineSubtotal).toBe(42500);
    expect(result.gstAmount).toBe(7650);
    expect(result.lineTotal).toBe(50150);
  });

  // Test 4 — GST not applicable
  it("treats an explicit 0% GST rate as a genuine zero-tax line", () => {
    const result = calculateLineGst({ quantity: 100, unitPrice: 500, gstRatePercent: 0 });
    expect(result.lineSubtotal).toBe(50000);
    expect(result.gstAmount).toBe(0);
    expect(result.lineTotal).toBe(50000);
  });

  it("falls back to DEFAULT_TAX_RATE_PERCENT when gstRatePercent is null/undefined", () => {
    const resultNull = calculateLineGst({ quantity: 10, unitPrice: 100, gstRatePercent: null });
    const resultUndefined = calculateLineGst({ quantity: 10, unitPrice: 100 });
    expect(resultNull.gstRatePercent).toBe(DEFAULT_TAX_RATE_PERCENT);
    expect(resultUndefined.gstRatePercent).toBe(DEFAULT_TAX_RATE_PERCENT);
  });

  it("avoids floating-point drift for odd decimal unit prices", () => {
    const result = calculateLineGst({ quantity: 3, unitPrice: 77.77, gstRatePercent: 18 });
    expect(result.lineSubtotal).toBe(233.31);
    expect(result.gstAmount).toBe(roundCurrency(41.9958));
    expect(result.lineTotal).toBe(roundCurrency(233.31 + roundCurrency(41.9958)));
  });
});

// Test 3 — Multiple GST rates
describe("aggregateQuotationTotals", () => {
  it("aggregates independently-taxed line items into quotation-level totals", () => {
    const itemA = calculateLineGst({ quantity: 100, unitPrice: 400, gstRatePercent: 18 });
    const itemB = calculateLineGst({ quantity: 10, unitPrice: 2000, gstRatePercent: 5 });

    expect(itemA.lineSubtotal).toBe(40000);
    expect(itemA.gstAmount).toBe(7200);
    expect(itemB.lineSubtotal).toBe(20000);
    expect(itemB.gstAmount).toBe(1000);

    const totals = aggregateQuotationTotals([itemA, itemB]);
    expect(totals.subtotal).toBe(60000);
    expect(totals.gstAmount).toBe(8200);
    expect(totals.grandTotal).toBe(68200);
  });

  it("returns zeroed totals for an empty line list", () => {
    const totals = aggregateQuotationTotals([]);
    expect(totals).toEqual({ subtotal: 0, gstAmount: 0, grandTotal: 0 });
  });
});

describe("isValidQuotedPrice / parseQuotedPrice", () => {
  // Test 5 — Negative price
  it("rejects negative numbers", () => {
    expect(isValidQuotedPrice(-100)).toBe(false);
    expect(parseQuotedPrice("-100")).toBeNull();
  });

  // Test 6 — Invalid price
  it("rejects non-numeric input", () => {
    expect(parseQuotedPrice("abc")).toBeNull();
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidQuotedPrice(NaN)).toBe(false);
    expect(isValidQuotedPrice(Infinity)).toBe(false);
    expect(isValidQuotedPrice(-Infinity)).toBe(false);
  });

  it("rejects empty/missing input", () => {
    expect(parseQuotedPrice("")).toBeNull();
    expect(parseQuotedPrice(null)).toBeNull();
    expect(parseQuotedPrice(undefined)).toBeNull();
  });

  it("accepts zero and positive finite numbers", () => {
    expect(isValidQuotedPrice(0)).toBe(true);
    expect(parseQuotedPrice("0")).toBe(0);
    expect(parseQuotedPrice("425.50")).toBe(425.5);
  });
});

describe("Form GST INV-01 State Code & UQC Helpers", () => {
  it("resolves 2-digit state code from GSTIN prefix", () => {
    expect(getStateCode(null, "33AANCT3003A1Z0")).toBe("33");
    expect(getStateCode(null, "29AABCS1429B1ZB")).toBe("29");
  });

  it("resolves 2-digit state code from state name", () => {
    expect(getStateCode("Tamil Nadu")).toBe("33");
    expect(getStateCode("karnataka")).toBe("29");
    expect(getStateCode("Kerala")).toBe("32");
    expect(getStateCode("Unknown State")).toBeNull();
  });

  it("resolves state name from 2-digit state code", () => {
    expect(getStateName("33")).toBe("Tamil Nadu");
    expect(getStateName("29")).toBe("Karnataka");
    expect(getStateName("99")).toBeNull();
  });

  it("normalizes product units to standard GST UQC codes", () => {
    expect(normalizeUqc("MT")).toBe("TON");
    expect(normalizeUqc("Metric Ton")).toBe("TON");
    expect(normalizeUqc("Bag")).toBe("BAG");
    expect(normalizeUqc("Bags")).toBe("BAG");
    expect(normalizeUqc("SQM")).toBe("SQM");
    expect(normalizeUqc("PCS")).toBe("NOS");
    expect(normalizeUqc("Boxes")).toBe("BOX");
    expect(normalizeUqc(null)).toBe("OTH");
  });

  it("resolveInvoiceDisplayUnit resolves site unit or intelligent domain fallback, never OTH", () => {
    // When explicit unit is present and not generic
    expect(resolveInvoiceDisplayUnit({ unit: "KGS", uqc: "KGS" })).toBe("KGS");
    expect(resolveInvoiceDisplayUnit({ unit: "MT", uqc: "TON" })).toBe("MT");
    expect(resolveInvoiceDisplayUnit({ unit: "BAG", uqc: "BAG" })).toBe("BAG");

    // When unit is missing or "Unit" or "OTH", but uqc is a valid specific code
    expect(resolveInvoiceDisplayUnit({ unit: null, uqc: "KGS" })).toBe("KGS");
    expect(resolveInvoiceDisplayUnit({ unit: "Unit", uqc: "BAG" })).toBe("BAG");

    // When uqc is "OTH" and unit is null/Unit, falls back to product name context
    expect(
      resolveInvoiceDisplayUnit({
        unit: null,
        uqc: "OTH",
        productName: "Vizag Steel 12mm TMT Bar Fe 500D",
      })
    ).toBe("MT");
    expect(
      resolveInvoiceDisplayUnit({
        unit: "Unit",
        uqc: "OTH",
        productName: "Tata Tiscon 16mm TMT Steel Bar",
      })
    ).toBe("MT");
    expect(
      resolveInvoiceDisplayUnit({
        unit: null,
        uqc: "OTH",
        productName: "UltraTech Super Cement 53 Grade",
      })
    ).toBe("BAG");

    // When unit is set to a site unit, even if uqc is "OTH", display unit preserves site unit
    expect(
      resolveInvoiceDisplayUnit({
        unit: "KGS",
        uqc: "OTH",
        productName: "Steel Rods",
      })
    ).toBe("KGS");

    // Fallback when nothing is known
    expect(resolveInvoiceDisplayUnit({ unit: null, uqc: "OTH" })).toBe("Unit");
  });
});

describe("calculateLineTaxSplit (Intra-state vs Inter-state)", () => {
  it("calculates CGST and SGST split for intra-state supplies (TN to TN)", () => {
    const result = calculateLineTaxSplit({
      quantity: 10,
      unitPrice: 1000,
      gstRatePercent: 18,
      sellerStateCode: "33",
      placeOfSupplyStateCode: "33",
    });

    expect(result.isIntraState).toBe(true);
    expect(result.taxableAmount).toBe(10000);
    expect(result.cgstRate).toBe(9);
    expect(result.cgstAmount).toBe(900);
    expect(result.sgstRate).toBe(9);
    expect(result.sgstAmount).toBe(900);
    expect(result.igstRate).toBe(0);
    expect(result.igstAmount).toBe(0);
    expect(result.totalTaxAmount).toBe(1800);
    expect(result.lineTotal).toBe(11800);
  });

  it("calculates IGST for inter-state supplies (TN to KA)", () => {
    const result = calculateLineTaxSplit({
      quantity: 10,
      unitPrice: 1000,
      gstRatePercent: 18,
      sellerStateCode: "33",
      placeOfSupplyStateCode: "29",
    });

    expect(result.isIntraState).toBe(false);
    expect(result.taxableAmount).toBe(10000);
    expect(result.cgstRate).toBe(0);
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstRate).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.igstRate).toBe(18);
    expect(result.igstAmount).toBe(1800);
    expect(result.totalTaxAmount).toBe(1800);
    expect(result.lineTotal).toBe(11800);
  });

  it("handles 0% tax lines gracefully", () => {
    const result = calculateLineTaxSplit({
      quantity: 5,
      unitPrice: 200,
      gstRatePercent: 0,
      sellerStateCode: "33",
      placeOfSupplyStateCode: "33",
    });

    expect(result.taxableAmount).toBe(1000);
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.igstAmount).toBe(0);
    expect(result.totalTaxAmount).toBe(0);
    expect(result.lineTotal).toBe(1000);
  });
});

describe("numberToIndianWords", () => {
  it("converts amounts to standard Indian numbering words", () => {
    expect(numberToIndianWords(0)).toBe("Rupees Zero Only");
    expect(numberToIndianWords(500)).toBe("Rupees Five Hundred Only");
    expect(numberToIndianWords(1500)).toBe("Rupees One Thousand Five Hundred Only");
    expect(numberToIndianWords(45250)).toBe("Rupees Forty-Five Thousand Two Hundred Fifty Only");
    expect(numberToIndianWords(145250.5)).toBe(
      "Rupees One Lakh Forty-Five Thousand Two Hundred Fifty and Paise Fifty Only"
    );
    expect(numberToIndianWords(25000000)).toBe("Rupees Two Crores Fifty Lakhs Only");
  });
});
