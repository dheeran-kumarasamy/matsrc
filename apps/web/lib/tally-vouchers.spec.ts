// Tally Purchase Voucher Supplier-Cost Fix — regression coverage for
// buildVouchersForBuilder() (see tally-vouchers.ts's own doc comments for
// the full confirmed/estimate/multi-supplier policy this implements).
//
// Mocking pattern mirrors order-checkout-markup.spec.ts exactly: @/lib/builder-db's
// `prisma` is replaced with hand-rolled jest-style mocks, no real database.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindMany = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: { findMany: (...args: unknown[]) => orderFindMany(...args) },
  },
}));

import { buildVouchersForBuilder } from "./tally-vouchers";
import { buildTallyImportXml, validateVouchers } from "./tally-xml";

// Mirrors tally-xml.spec.ts's identical helper exactly — scoped to
// <ALLLEDGERENTRIES.LIST> blocks only, so <ALLINVENTORYENTRIES.LIST>'s own
// <AMOUNT> (the taxable value, not a ledger debit/credit) is never counted.
function sumLedgerAmounts(xmlFragment: string): number {
  const matches = [
    ...xmlFragment.matchAll(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g),
  ];
  return matches.reduce((sum, m) => sum + Number(m[1]), 0);
}

function mapping(supplierLedgerMap: Record<string, string>) {
  return {
    companyName: "Triad Build Tech",
    purchaseLedger: "Purchase Account",
    cgstLedger: "CGST",
    sgstLedger: "SGST",
    igstLedger: "IGST",
    roundOffLedger: "Round Off",
    supplierLedgerMap,
  };
}

const BUILDER_ID = "builder-1";
const SUPPLIER_A = "supplier-a";
const SUPPLIER_B = "supplier-b";

function supplier(overrides: Record<string, unknown> = {}) {
  return { companyName: "ABC Steel Traders", gstin: "27AAAAA0000A1Z5", ...overrides };
}

function product(overrides: Record<string, unknown> = {}) {
  return { name: "TMT Bar Fe-500D", unit: "kg", hsnCode: "7214", ...overrides };
}

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    quantity: 10,
    unitPrice: 120, // buyer-facing marked-up price
    supplierUnitPrice: 100, // agreed supplier rate before markup
    taxRatePercent: 18,
    supplierId: SUPPLIER_A,
    supplier: supplier(),
    product: product(),
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    createdAt: new Date("2024-05-15T00:00:00.000Z"),
    totalAmount: 1416,
    site: { id: "site-1", state: "Maharashtra", gstin: "27BBBBB0000B1Z5" },
    items: [orderItem()],
    supplierInvoice: null,
    ...overrides,
  };
}

beforeEach(() => {
  orderFindMany.mockReset();
});

describe("buildVouchersForBuilder — confirmed supplier invoice", () => {
  it("uses approved supplier line values, not the buyer-marked-up unitPrice", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1180, // 1000 + 180 GST
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(blockers).toHaveLength(0);
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0].isEstimate).toBe(false);
    expect(vouchers[0].lineItems[0].unitPrice).toBe(100); // NOT the buyer's 120
    expect(vouchers[0].lineItems[0].taxableValue).toBe(1000);
    expect(vouchers[0].lineItems[0].gstAmount).toBe(180);
    expect(vouchers[0].total).toBe(1180);
  });

  it("reconciles confirmed GST/totals without double-counting", async () => {
    orderFindMany.mockResolvedValue([
      order({
        items: [
          orderItem({ id: "item-1" }),
          orderItem({ id: "item-2", quantity: 5, unitPrice: 240, supplierUnitPrice: 200 }),
        ],
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 2360, // (1000+180) + (1000+180)
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
            {
              orderItemId: "item-2",
              approvedUnitPrice: 200,
              actualQuantity: 5,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(blockers).toHaveLength(0);
    expect(vouchers[0].total).toBe(2360);
  });

  it("blocks (never silently absorbs into round-off) when freight/other-charges/discount exist with no mapped ledger", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 50,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1230,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers).toHaveLength(0);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toContain("no mapped Tally ledger");
  });

  it("passes a genuine rounding adjustment through to the voucher (matches round-off ledger semantics)", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0.5,
          confirmedTotalAmount: 1180.5,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(blockers).toHaveLength(0);
    expect(vouchers[0].roundingAdjustment).toBe(0.5);
    expect(vouchers[0].total).toBe(1180.5);
  });

  it("confirmed partial quantity uses actualQuantity, not OrderItem.quantity", async () => {
    orderFindMany.mockResolvedValue([
      order({
        items: [orderItem({ quantity: 10 })], // ordered 10
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 944, // only 8 units actually invoiced
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 8,
              taxRatePercent: 18,
              lineSubtotal: 800,
              lineTaxAmount: 144,
              lineTotal: 944,
            },
          ],
        },
      }),
    ]);

    const { vouchers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers[0].lineItems[0].quantity).toBe(8);
  });

  it("approved rate override uses approvedUnitPrice, not the agreed supplierUnitPrice", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1298,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 110, // admin-approved override, differs from supplierUnitPrice (100)
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1100,
              lineTaxAmount: 198,
              lineTotal: 1298,
            },
          ],
        },
      }),
    ]);

    const { vouchers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers[0].lineItems[0].unitPrice).toBe(110);
  });
});

describe("buildVouchersForBuilder — pending/absent supplier invoice (estimate)", () => {
  it("PENDING_REVIEW invoice produces an explicitly marked estimate using supplierUnitPrice", async () => {
    orderFindMany.mockResolvedValue([
      order({ supplierInvoice: { status: "PENDING_REVIEW", lineItems: [] } }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(blockers).toHaveLength(0);
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0].isEstimate).toBe(true);
    expect(vouchers[0].lineItems[0].unitPrice).toBe(100); // supplierUnitPrice, not buyer's 120
  });

  it("no supplier invoice at all produces an explicitly marked estimate using supplierUnitPrice", async () => {
    orderFindMany.mockResolvedValue([order({ supplierInvoice: null })]);

    const { vouchers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers[0].isEstimate).toBe(true);
    expect(vouchers[0].lineItems[0].unitPrice).toBe(100);
  });

  it("legacy row with null supplierUnitPrice falls back to unitPrice (implicit 0% markup)", async () => {
    orderFindMany.mockResolvedValue([
      order({
        items: [orderItem({ supplierUnitPrice: null, unitPrice: 100 })],
        supplierInvoice: null,
      }),
    ]);

    const { vouchers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers[0].isEstimate).toBe(true);
    expect(vouchers[0].lineItems[0].unitPrice).toBe(100);
  });
});

describe("buildVouchersForBuilder — multi-supplier orders", () => {
  it("estimated multi-supplier order splits into separate, correctly attributed vouchers", async () => {
    orderFindMany.mockResolvedValue([
      order({
        items: [
          orderItem({ id: "item-1", supplierId: SUPPLIER_A, supplier: supplier({ companyName: "Supplier A" }) }),
          orderItem({
            id: "item-2",
            supplierId: SUPPLIER_B,
            supplier: supplier({ companyName: "Supplier B" }),
            quantity: 5,
            unitPrice: 60,
            supplierUnitPrice: 50,
          }),
        ],
        supplierInvoice: null,
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(blockers).toHaveLength(0);
    expect(vouchers).toHaveLength(2);
    const bySupplier = new Map(vouchers.map((v) => [v.supplierId, v]));
    expect(bySupplier.get(SUPPLIER_A)?.lineItems).toHaveLength(1);
    expect(bySupplier.get(SUPPLIER_B)?.lineItems).toHaveLength(1);
    expect(bySupplier.get(SUPPLIER_A)?.supplierName).toBe("Supplier A");
    expect(bySupplier.get(SUPPLIER_B)?.supplierName).toBe("Supplier B");
  });

  it("confirmed multi-supplier order is rejected with a clear blocker, never split with an invented allocation", async () => {
    orderFindMany.mockResolvedValue([
      order({
        items: [
          orderItem({ id: "item-1", supplierId: SUPPLIER_A }),
          orderItem({ id: "item-2", supplierId: SUPPLIER_B, quantity: 5, unitPrice: 60, supplierUnitPrice: 50 }),
        ],
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1475,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
            {
              orderItemId: "item-2",
              approvedUnitPrice: 50,
              actualQuantity: 5,
              taxRatePercent: 18,
              lineSubtotal: 250,
              lineTaxAmount: 45,
              lineTotal: 295,
            },
          ],
        },
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers).toHaveLength(0);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toContain("spans multiple suppliers");
  });
});

describe("buildVouchersForBuilder — inconsistent confirmed data fails closed", () => {
  it("confirmed invoice with mismatched line count never becomes an estimate", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1180,
          lineItems: [], // missing the one line the order actually has
        },
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers).toHaveLength(0);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toContain("does not cover every order line item");
  });

  it("confirmed invoice whose line totals don't reconcile with confirmedTotalAmount is blocked, not silently exported", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 9999, // corrupted/inconsistent
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers).toHaveLength(0);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toContain("do not reconcile");
  });
});

describe("buildVouchersForBuilder — overall counts across an export batch", () => {
  it("returns a mix of confirmed and estimate vouchers, plus blockers, in a single call", async () => {
    orderFindMany.mockResolvedValue([
      order({
        id: "order-confirmed",
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1180,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
      order({ id: "order-estimate", supplierInvoice: null }),
    ]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(blockers).toHaveLength(0);
    expect(vouchers).toHaveLength(2);
    const confirmed = vouchers.filter((v) => !v.isEstimate);
    const estimated = vouchers.filter((v) => v.isEstimate);
    expect(confirmed).toHaveLength(1);
    expect(estimated).toHaveLength(1);
  });

  it("dry-run counts (via validateVouchers) are accurate for a mixed batch, including excluded orders", async () => {
    orderFindMany.mockResolvedValue([
      order({
        id: "order-confirmed",
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1180,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
      order({ id: "order-estimate", supplierInvoice: null }),
    ]);

    const { vouchers, blockers: exclusionBlockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    const dryRun = validateVouchers(vouchers, mapping({ [SUPPLIER_A]: "ABC Steel Traders" }));

    expect(dryRun.confirmedCount).toBe(1);
    expect(dryRun.estimatedCount).toBe(1);
    expect(dryRun.voucherCount).toBe(2);
    expect(dryRun.blockers).toHaveLength(0);
    expect(exclusionBlockers).toHaveLength(0);
  });
});

describe("buildVouchersForBuilder + tally-xml — generated XML stays valid and balanced", () => {
  it("a confirmed voucher's XML is valid, carries no ESTIMATE marker, and balances", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0,
          confirmedTotalAmount: 1180,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
    ]);

    const { vouchers } = await buildVouchersForBuilder(BUILDER_ID, {});
    const xml = buildTallyImportXml(vouchers, mapping({ [SUPPLIER_A]: "ABC Steel Traders" }));
    expect(xml).not.toContain("ESTIMATE");
    expect(xml.match(/<VOUCHER /g)).toHaveLength(1);
    expect(sumLedgerAmounts(xml)).toBeCloseTo(0, 2);
  });

  it("an estimate voucher's XML carries the ESTIMATE narration marker and balances", async () => {
    orderFindMany.mockResolvedValue([order({ supplierInvoice: null })]);

    const { vouchers } = await buildVouchersForBuilder(BUILDER_ID, {});
    const xml = buildTallyImportXml(vouchers, mapping({ [SUPPLIER_A]: "ABC Steel Traders" }));
    expect(xml).toContain("ESTIMATE - Supplier invoice not confirmed");
    expect(sumLedgerAmounts(xml)).toBeCloseTo(0, 2);
  });

  it("a confirmed voucher with a genuine rounding adjustment still balances via the round-off ledger", async () => {
    orderFindMany.mockResolvedValue([
      order({
        supplierInvoice: {
          status: "CONFIRMED",
          freightChargeAmount: 0,
          otherChargesAmount: 0,
          discountAmount: 0,
          roundingAdjustment: 0.5,
          confirmedTotalAmount: 1180.5,
          lineItems: [
            {
              orderItemId: "item-1",
              approvedUnitPrice: 100,
              actualQuantity: 10,
              taxRatePercent: 18,
              lineSubtotal: 1000,
              lineTaxAmount: 180,
              lineTotal: 1180,
            },
          ],
        },
      }),
    ]);

    const { vouchers } = await buildVouchersForBuilder(BUILDER_ID, {});
    const xml = buildTallyImportXml(vouchers, mapping({ [SUPPLIER_A]: "ABC Steel Traders" }));
    expect(sumLedgerAmounts(xml)).toBeCloseTo(0, 2);
  });
});

describe("buildVouchersForBuilder — missing supplier attribution handled safely", () => {
  it("skips an order with zero line items rather than throwing", async () => {
    orderFindMany.mockResolvedValue([order({ items: [], supplierInvoice: null })]);

    const { vouchers, blockers } = await buildVouchersForBuilder(BUILDER_ID, {});
    expect(vouchers).toHaveLength(0);
    expect(blockers).toHaveLength(0);
  });
});
