import { describe, it, expect, vi } from "vitest";
import { calculateOrderSettledAmount, checkOrderDispatchEligibility } from "./order-dispatch-eligibility";

function buildTx(overrides: {
  order?: any;
  ledgerEntries?: Array<{ type: string; amount: number }>;
  verification?: { status: string; amount: number } | null;
}) {
  const orderFindUnique = vi.fn(async () => overrides.order ?? null);
  const ledgerFindMany = vi.fn(async () => overrides.ledgerEntries ?? []);
  const verificationFindUnique = vi.fn(async () => overrides.verification ?? null);

  return {
    tx: {
      order: { findUnique: orderFindUnique },
      customerAdvanceTransaction: { findMany: ledgerFindMany },
      paymentVerification: { findUnique: verificationFindUnique },
    },
    orderFindUnique,
    ledgerFindMany,
    verificationFindUnique,
  };
}

describe("calculateOrderSettledAmount", () => {
  it("sums ORDER_PAYMENT ledger entries and nets REFUND/REVERSAL", async () => {
    const { tx } = buildTx({
      ledgerEntries: [
        { type: "ORDER_PAYMENT", amount: 5000 },
        { type: "REFUND", amount: 1000 },
      ],
      verification: null,
    });
    const settled = await calculateOrderSettledAmount(tx as any, "order-1");
    expect(settled).toBe(4000);
  });

  it("counts an APPROVED bank-transfer verification's amount", async () => {
    const { tx } = buildTx({ ledgerEntries: [], verification: { status: "APPROVED", amount: 7000 } });
    const settled = await calculateOrderSettledAmount(tx as any, "order-1");
    expect(settled).toBe(7000);
  });

  it("never counts a PENDING (unverified) bank-transfer proof as settled funds", async () => {
    const { tx } = buildTx({ ledgerEntries: [], verification: { status: "PENDING", amount: 7000 } });
    const settled = await calculateOrderSettledAmount(tx as any, "order-1");
    expect(settled).toBe(0);
  });

  it("never counts a REJECTED bank-transfer proof as settled funds", async () => {
    const { tx } = buildTx({ ledgerEntries: [], verification: { status: "REJECTED", amount: 7000 } });
    const settled = await calculateOrderSettledAmount(tx as any, "order-1");
    expect(settled).toBe(0);
  });

  it("combines advance-ledger settlement and an approved bank-transfer proof without double counting", async () => {
    const { tx } = buildTx({
      ledgerEntries: [{ type: "ORDER_PAYMENT", amount: 3000 }],
      verification: { status: "APPROVED", amount: 4000 },
    });
    const settled = await calculateOrderSettledAmount(tx as any, "order-1");
    expect(settled).toBe(7000);
  });
});

describe("checkOrderDispatchEligibility", () => {
  it("blocks dispatch when the order has no SupplierInvoice at all", async () => {
    const { tx } = buildTx({ order: { paymentStatus: "PAID", supplierInvoice: null } });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/has not yet uploaded an invoice/i);
  });

  it("blocks dispatch when the SupplierInvoice is still PENDING_REVIEW", async () => {
    const { tx } = buildTx({
      order: { paymentStatus: "PAID", supplierInvoice: { status: "PENDING_REVIEW", confirmedTotalAmount: null } },
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/awaiting Admin review/i);
  });

  it("blocks dispatch when the SupplierInvoice was REJECTED", async () => {
    const { tx } = buildTx({
      order: { paymentStatus: "PAID", supplierInvoice: { status: "REJECTED", confirmedTotalAmount: null } },
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/was rejected/i);
  });

  it("blocks dispatch when the order has been REFUNDED", async () => {
    const { tx } = buildTx({
      order: { paymentStatus: "REFUNDED", supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 10000 } },
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/refunded/i);
  });

  it("blocks dispatch when the confirmed total is only PARTIALLY paid", async () => {
    const { tx } = buildTx({
      order: { paymentStatus: "PAID", supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 10000 } },
      ledgerEntries: [{ type: "ORDER_PAYMENT", amount: 6000 }],
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/not been fully paid/i);
      expect(result.settledAmount).toBe(6000);
      expect(result.finalPayableAmount).toBe(10000);
    }
  });

  it("blocks dispatch when a payment covering only the OLD pre-freight amount is less than the new confirmed total", async () => {
    // Buyer paid the pre-confirmation estimate (8000) before the admin
    // confirmed freight charges that raised the final total to 10000.
    const { tx } = buildTx({
      order: {
        paymentStatus: "PAID",
        totalAmount: 8000,
        finalPayableAmount: 8000,
        supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 10000 },
      },
      verification: { status: "APPROVED", amount: 8000 },
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.settledAmount).toBe(8000);
  });

  it("allows dispatch once the confirmed total is fully settled via advance ledger", async () => {
    const { tx } = buildTx({
      order: { paymentStatus: "PAID", supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 10000 } },
      ledgerEntries: [{ type: "ORDER_PAYMENT", amount: 10000 }],
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.finalPayableAmount).toBe(10000);
      expect(result.settledAmount).toBe(10000);
    }
  });

  it("allows dispatch once the confirmed total is fully settled via an approved bank-transfer proof", async () => {
    const { tx } = buildTx({
      order: { paymentStatus: "PAID", supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 10000 } },
      verification: { status: "APPROVED", amount: 10000 },
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(true);
  });

  it("allows dispatch within the one-cent rounding tolerance", async () => {
    const { tx } = buildTx({
      order: { paymentStatus: "PAID", supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 10000 } },
      ledgerEntries: [{ type: "ORDER_PAYMENT", amount: 9999.995 }],
    });
    const result = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(result.eligible).toBe(true);
  });

  it("never double-counts across repeated/retried eligibility checks for the same order", async () => {
    const { tx, verificationFindUnique } = buildTx({
      order: { paymentStatus: "PAID", supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 10000 } },
      verification: { status: "APPROVED", amount: 10000 },
    });
    const first = await checkOrderDispatchEligibility(tx as any, "order-1");
    const second = await checkOrderDispatchEligibility(tx as any, "order-1");
    expect(first.eligible).toBe(true);
    expect(second.eligible).toBe(true);
    if (first.eligible && second.eligible) {
      expect(first.settledAmount).toBe(second.settledAmount);
    }
    expect(verificationFindUnique).toHaveBeenCalledTimes(2);
  });

  it("returns an ineligible result (not a throw) when the order cannot be found", async () => {
    const { tx } = buildTx({ order: null });
    const result = await checkOrderDispatchEligibility(tx as any, "missing-order");
    expect(result.eligible).toBe(false);
  });
});
