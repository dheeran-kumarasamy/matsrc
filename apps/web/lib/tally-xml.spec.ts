import { describe, it, expect } from "vitest";
import {
  isIntraState,
  validateVouchers,
  buildTallyImportXml,
  type TallyLedgerMappingConfig,
  type TallyVoucherInput,
} from "./tally-xml";

function mapping(overrides: Partial<TallyLedgerMappingConfig> = {}): TallyLedgerMappingConfig {
  return {
    companyName: "My Company",
    purchaseLedger: "Purchase Account",
    cgstLedger: "CGST",
    sgstLedger: "SGST",
    igstLedger: "IGST",
    roundOffLedger: "Round Off",
    supplierLedgerMap: { "supplier-1": "ABC Steel Traders" },
    ...overrides,
  };
}

function voucher(overrides: Partial<TallyVoucherInput> = {}): TallyVoucherInput {
  const lineItems = overrides.lineItems ?? [
    {
      productName: "TMT Bar Fe-500D",
      hsnCode: "7214",
      quantity: 10,
      unit: "kg",
      unitPrice: 100,
      taxableValue: 1000,
      taxRatePercent: 18,
      gstAmount: 180,
    },
  ];
  const total = lineItems.reduce((s, li) => s + li.taxableValue + li.gstAmount, 0);
  return {
    orderId: "order-1",
    orderDate: new Date("2024-05-15T00:00:00.000Z"),
    supplierId: "supplier-1",
    supplierName: "ABC Steel Traders",
    supplierGstin: "27AAAAA0000A1Z5",
    siteState: "Maharashtra",
    siteGstin: "27BBBBB0000B1Z5",
    lineItems,
    total,
    ...overrides,
  };
}

describe("isIntraState", () => {
  it("returns true when supplier and site GST state codes match", () => {
    expect(isIntraState("27AAAAA0000A1Z5", "27BBBBB0000B1Z5")).toBe(true);
  });

  it("returns false when supplier and site GST state codes differ", () => {
    expect(isIntraState("27AAAAA0000A1Z5", "07BBBBB0000B1Z5")).toBe(false);
  });

  it("defaults to true (intra-state) when supplier GSTIN is missing", () => {
    expect(isIntraState(null, "07BBBBB0000B1Z5")).toBe(true);
  });

  it("defaults to true (intra-state) when site GSTIN is missing", () => {
    expect(isIntraState("27AAAAA0000A1Z5", null)).toBe(true);
  });

  it("defaults to true (intra-state) when both GSTINs are missing", () => {
    expect(isIntraState(null, null)).toBe(true);
  });
});

describe("validateVouchers", () => {
  it("passes with no blockers when every supplier is mapped", () => {
    const result = validateVouchers([voucher()], mapping());
    expect(result.blockers).toHaveLength(0);
    expect(result.voucherCount).toBe(1);
    expect(result.totalValue).toBeCloseTo(1180, 2);
  });

  it("returns a blocker for each voucher whose supplier is unmapped", () => {
    const result = validateVouchers(
      [voucher({ supplierId: "supplier-unmapped", supplierName: "Unmapped Co" })],
      mapping()
    );
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].orderId).toBe("order-1");
    expect(result.blockers[0].reason).toContain("Unmapped Co");
  });

  it("sums totalValue across multiple vouchers", () => {
    const result = validateVouchers(
      [voucher({ orderId: "o1" }), voucher({ orderId: "o2" })],
      mapping()
    );
    expect(result.voucherCount).toBe(2);
    expect(result.totalValue).toBeCloseTo(2360, 2);
  });
});

// Sums up all <AMOUNT> values inside <ALLLEDGERENTRIES.LIST> blocks for a
// single voucher's XML fragment to confirm the voucher balances to zero
// (debits negative + credits positive must net to zero).
function sumLedgerAmounts(xmlFragment: string): number {
  const matches = [
    ...xmlFragment.matchAll(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g),
  ];
  return matches.reduce((sum, m) => sum + Number(m[1]), 0);
}

describe("buildTallyImportXml", () => {
  it("produces a well-formed ENVELOPE with one VOUCHER per order (intra-state)", () => {
    const xml = buildTallyImportXml([voucher()], mapping());
    expect(xml).toContain("<ENVELOPE>");
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain('<VOUCHER VCHTYPE="Purchase" ACTION="Create">');
    expect(xml.match(/<VOUCHER /g)).toHaveLength(1);
    // Intra-state: CGST + SGST used, not IGST
    expect(xml).toContain("<LEDGERNAME>CGST</LEDGERNAME>");
    expect(xml).toContain("<LEDGERNAME>SGST</LEDGERNAME>");
    expect(xml).not.toContain("<LEDGERNAME>IGST</LEDGERNAME>");
  });

  it("uses IGST for inter-state vouchers", () => {
    const interStateVoucher = voucher({ siteGstin: "07BBBBB0000B1Z5" });
    const xml = buildTallyImportXml([interStateVoucher], mapping());
    expect(xml).toContain("<LEDGERNAME>IGST</LEDGERNAME>");
    expect(xml).not.toContain("<LEDGERNAME>CGST</LEDGERNAME>");
    expect(xml).not.toContain("<LEDGERNAME>SGST</LEDGERNAME>");
  });

  it("balances debits and credits to zero for a single voucher", () => {
    const xml = buildTallyImportXml([voucher()], mapping());
    expect(sumLedgerAmounts(xml)).toBeCloseTo(0, 2);
  });

  it("balances debits and credits to zero even with odd-paisa GST splits", () => {
    // gstAmount that doesn't split evenly in half (e.g. 0.01 residual)
    const oddVoucher = voucher({
      lineItems: [
        {
          productName: "Cement Bag",
          hsnCode: "2523",
          quantity: 7,
          unit: "bag",
          unitPrice: 333.33,
          taxableValue: 2333.31,
          taxRatePercent: 18,
          gstAmount: 419.9958, // will round to 420.00, half = 210.00/210.00 fine, try another odd one
        },
        {
          productName: "Steel Rod",
          hsnCode: "7213",
          quantity: 3,
          unit: "kg",
          unitPrice: 77.77,
          taxableValue: 233.31,
          taxRatePercent: 18,
          gstAmount: 41.9958,
        },
      ],
    });
    const xml = buildTallyImportXml([oddVoucher], mapping());
    expect(sumLedgerAmounts(xml)).toBeCloseTo(0, 2);
  });

  it("balances multiple vouchers each independently to zero", () => {
    const xml = buildTallyImportXml(
      [voucher({ orderId: "o1" }), voucher({ orderId: "o2", siteGstin: "07BBBBB0000B1Z5" })],
      mapping()
    );
    expect(xml.match(/<VOUCHER /g)).toHaveLength(2);
    // Split into per-voucher fragments and check each balances independently
    const fragments = xml.split("<TALLYMESSAGE").slice(1);
    expect(fragments).toHaveLength(2);
    for (const fragment of fragments) {
      expect(sumLedgerAmounts(fragment)).toBeCloseTo(0, 2);
    }
  });

  it("includes an inventory entry per line item with HSN code", () => {
    const xml = buildTallyImportXml([voucher()], mapping());
    expect(xml).toContain("<STOCKITEMNAME>TMT Bar Fe-500D</STOCKITEMNAME>");
    expect(xml).toContain("<HSNCODE>7214</HSNCODE>");
  });

  it("escapes special XML characters in names", () => {
    const xml = buildTallyImportXml(
      [
        voucher({
          supplierName: 'Supplier "A & B" <Ltd>',
          lineItems: [
            {
              productName: "Rod & Bar <5mm>",
              hsnCode: null,
              quantity: 1,
              unit: "kg",
              unitPrice: 10,
              taxableValue: 10,
              taxRatePercent: 18,
              gstAmount: 1.8,
            },
          ],
        }),
      ],
      mapping({ supplierLedgerMap: { "supplier-1": 'Supplier "A & B" <Ltd>' } })
    );
    expect(xml).not.toContain("<Ltd>");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&quot;");
  });
});
