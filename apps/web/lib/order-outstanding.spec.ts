// Unit tests for computeOrderOutstandingAmount — Product-Level GST /
// GST-Inclusive Buyer Payable (Phase 4). Prisma is mocked (same pattern as
// lib/order-advance-payment-route.spec.ts); no real database/network calls.
//
// Focus: the new-order vs legacy-order payable resolution contract —
//   - A confirmed order (finalPayableAmount set) must use the frozen,
//     GST-inclusive finalPayableAmount, never totalAmount or a recomputed
//     value.
//   - A legacy/not-yet-confirmed order (finalPayableAmount null) must keep
//     using the pre-existing totalAmount, and must NEVER be treated as
//     "zero tax" or have today's GST config applied retroactively.
//   - A partially-populated snapshot (one of the paired fields set, the
//     other null) must fail loudly rather than silently pick a value.
//   - Credited advances (ORDER_PAYMENT, REFUND/REVERSAL netting, ACTIVE
//     reservations) are applied exactly once against the resolved payable,
//     and the outstanding amount never goes negative.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindUnique = vi.fn();
const customerAdvanceTransactionFindMany = vi.fn();
const advanceReservationFindUnique = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: { findUnique: (...args: unknown[]) => orderFindUnique(...args) },
    customerAdvanceTransaction: {
      findMany: (...args: unknown[]) => customerAdvanceTransactionFindMany(...args),
    },
    advanceReservation: {
      findUnique: (...args: unknown[]) => advanceReservationFindUnique(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  customerAdvanceTransactionFindMany.mockResolvedValue([]);
  advanceReservationFindUnique.mockResolvedValue(null);
});

describe("computeOrderOutstandingAmount — new order with a complete GST snapshot", () => {
  it("uses finalPayableAmount (GST-inclusive), not totalAmount, as the payable base", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 11000, // GST-exclusive subtotal
      taxAmount: 1980,
      finalPayableAmount: 12980, // GST-inclusive
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-1");

    expect(result.totalAmount).toBe(12980);
    expect(result.outstanding).toBe(12980);
    expect(result.advanceApplied).toBe(0);
  });

  it("never recomputes from current config — the frozen taxAmount/finalPayableAmount are read as-is", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 500, // an unusual/old rate relative to whatever is configured "today"
      finalPayableAmount: 10500,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-1");

    expect(result.totalAmount).toBe(10500);
  });
});

describe("computeOrderOutstandingAmount — legacy order with a null snapshot", () => {
  it("falls back to totalAmount (GST-exclusive) and never infers zero tax from the null snapshot", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 9000,
      taxAmount: null,
      finalPayableAmount: null,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-legacy");

    expect(result.totalAmount).toBe(9000);
    expect(result.outstanding).toBe(9000);
  });

  it("treats an order row missing the GST snapshot columns entirely (pre-migration mock shape) the same as explicit nulls", async () => {
    orderFindUnique.mockResolvedValue({ totalAmount: 5000 });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-legacy-2");

    expect(result.totalAmount).toBe(5000);
  });
});

describe("computeOrderOutstandingAmount — inconsistent/partial snapshot", () => {
  it("throws rather than silently picking a value when taxAmount is set but finalPayableAmount is null", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: null,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    await expect(computeOrderOutstandingAmount("order-broken")).rejects.toThrow(/inconsistent financial snapshot/i);
  });

  it("throws when advancePercent is set but finalPayableAmount is null", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: null,
      finalPayableAmount: null,
      advancePercent: 20,
      requiredAdvanceAmount: 2000,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    await expect(computeOrderOutstandingAmount("order-broken-2")).rejects.toThrow(/inconsistent financial snapshot/i);
  });

  it("throws (Phase 4.4) when a confirmed snapshot's finalPayableAmount does not arithmetically reconcile with totalAmount + taxAmount", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 99999, // wrong — should be 11800
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    await expect(computeOrderOutstandingAmount("order-bad-arithmetic")).rejects.toThrow(
      /inconsistent financial snapshot/i
    );
  });

  it("does not throw the arithmetic check for a legacy order (never reconciles a null snapshot)", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: null,
      finalPayableAmount: null,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-legacy-arith");
    expect(result.totalAmount).toBe(10000);
  });
});

describe("computeOrderOutstandingAmount — credited advances against the resolved payable", () => {
  it("nets a full settled ORDER_PAYMENT against the GST-inclusive payable, flooring outstanding at 0", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });
    customerAdvanceTransactionFindMany.mockResolvedValue([{ type: "ORDER_PAYMENT", amount: 11800 }]);

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-paid");

    expect(result.outstanding).toBe(0);
  });

  it("applies a partial credit exactly once (no double counting with an ACTIVE reservation on the same amount)", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });
    customerAdvanceTransactionFindMany.mockResolvedValue([]);
    advanceReservationFindUnique.mockResolvedValue({ amount: 5000, status: "ACTIVE" });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-partial");

    expect(result.advanceApplied).toBe(5000);
    expect(result.outstanding).toBe(6800);
  });

  it("does not double-count a CONSUMED reservation already reflected as an ORDER_PAYMENT ledger entry", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });
    customerAdvanceTransactionFindMany.mockResolvedValue([{ type: "ORDER_PAYMENT", amount: 5000 }]);
    advanceReservationFindUnique.mockResolvedValue({ amount: 5000, status: "CONSUMED" });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-consumed");

    expect(result.advanceApplied).toBe(5000);
    expect(result.outstanding).toBe(6800);
  });

  it("nets a REVERSAL back against a previously-applied ORDER_PAYMENT, never driving outstanding negative", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 1000,
      taxAmount: 180,
      finalPayableAmount: 1180,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });
    customerAdvanceTransactionFindMany.mockResolvedValue([
      { type: "ORDER_PAYMENT", amount: 1180 },
      { type: "REVERSAL", amount: 1180 },
    ]);

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-reversed");

    expect(result.advanceApplied).toBe(0);
    expect(result.outstanding).toBe(1180);
  });

  it("zero credited advance leaves the full GST-inclusive payable outstanding", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 2000,
      taxAmount: 360,
      finalPayableAmount: 2360,
      advancePercent: 10,
      requiredAdvanceAmount: 236,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-zero-credit");

    expect(result.outstanding).toBe(2360);
  });
});

describe("computeOrderOutstandingAmount — not found", () => {
  it("throws when the order does not exist", async () => {
    orderFindUnique.mockResolvedValue(null);
    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    await expect(computeOrderOutstandingAmount("missing")).rejects.toThrow(/not found/i);
  });
});

// Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
// Dispatch — once an Admin has confirmed the SupplierInvoice, its
// confirmedTotalAmount must supersede the pre-confirmation
// finalPayableAmount/totalAmount estimate as the authoritative payable
// base this function computes `outstanding` against.
describe("computeOrderOutstandingAmount — Admin-confirmed SupplierInvoice total supersedes the pre-confirmation estimate", () => {
  it("uses the higher, admin-confirmed total (e.g. freight added) instead of the lower pre-confirmation estimate", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
      supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 13500 },
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-freight-added");

    expect(result.totalAmount).toBe(13500);
    expect(result.outstanding).toBe(13500);
  });

  it("uses the lower, admin-confirmed total (e.g. a discount) instead of the higher pre-confirmation estimate", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
      supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 9500 },
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-discounted");

    expect(result.totalAmount).toBe(9500);
  });

  it("a payment covering only the OLD pre-freight estimate leaves a real outstanding balance against the NEW confirmed total", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
      supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 13500 },
    });
    // Buyer already settled the OLD 11800 pre-confirmation estimate.
    customerAdvanceTransactionFindMany.mockResolvedValue([{ type: "ORDER_PAYMENT", amount: 11800 }]);

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-stale-payment");

    expect(result.outstanding).toBe(1700);
  });

  it("still uses the pre-confirmation estimate while the SupplierInvoice is PENDING_REVIEW", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
      supplierInvoice: { status: "PENDING_REVIEW", confirmedTotalAmount: null },
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-pending-review");

    expect(result.totalAmount).toBe(11800);
  });

  it("still uses the pre-confirmation estimate when there is no SupplierInvoice at all", async () => {
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
      supplierInvoice: null,
    });

    const { computeOrderOutstandingAmount } = await import("./order-outstanding");
    const result = await computeOrderOutstandingAmount("order-no-invoice");

    expect(result.totalAmount).toBe(11800);
  });
});
