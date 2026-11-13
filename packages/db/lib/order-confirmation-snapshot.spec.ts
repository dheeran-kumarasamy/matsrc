import { describe, expect, it, vi } from "vitest";
import {
  resolveOrderConfirmationSnapshot,
  assertConsistentOrderSnapshot,
  hasCompleteOrderSnapshot,
  InconsistentOrderSnapshotError,
  assertConsistentOrderItemSnapshot,
  assertConsistentOrderSnapshotArithmetic,
  assertOrderTaxAmountReconcilesWithItems,
  assertFullOrderSnapshotIntegrity,
} from "./order-confirmation-snapshot";

function fakeTx(opts: {
  taxRows?: Array<{ scope: string; scopeId: string | null; percentage: number; isEnabled: boolean }>;
  advanceConfig?: { percentage: number; isEnabled: boolean } | null;
}) {
  return {
    taxSetting: {
      findMany: vi.fn().mockResolvedValue(opts.taxRows ?? []),
    },
    advanceConfig: {
      findUnique: vi.fn().mockResolvedValue(opts.advanceConfig ?? null),
    },
  };
}

describe("resolveOrderConfirmationSnapshot — correct markup + GST for a normal order", () => {
  it("computes buyer price, GST-on-marked-up-value, subtotal, tax, and final payable", async () => {
    const tx = fakeTx({
      taxRows: [{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }],
    });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      {
        lineItemId: "line-1",
        productId: "prod-1",
        categoryId: "cat-1",
        supplierUnitPrice: 1000,
        markupPercent: 10,
        quantity: 2,
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.lines[0].buyerUnitPrice).toBe(1100);
    expect(result.snapshot.lines[0].supplierUnitPrice).toBe(1000);
    expect(result.snapshot.lines[0].taxRatePercent).toBe(18);
    expect(result.snapshot.lines[0].taxAmount).toBe(396);
    expect(result.snapshot.subtotal).toBe(2200);
    expect(result.snapshot.taxAmount).toBe(396);
    expect(result.snapshot.finalPayableAmount).toBe(2596);
  });

  it("calculates GST on the marked-up buyer value, never the original supplier price", async () => {
    const tx = fakeTx({ taxRows: [{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }] });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 10, quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.lines[0].taxAmount).toBe(198);
    expect(result.snapshot.lines[0].taxAmount).not.toBe(180);
  });

  it("preserves the original supplier price distinct from the buyer price", async () => {
    const tx = fakeTx({ taxRows: [{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }] });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 500, markupPercent: 20, quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.lines[0].supplierUnitPrice).toBe(500);
    expect(result.snapshot.lines[0].buyerUnitPrice).toBe(600);
  });
});

describe("resolveOrderConfirmationSnapshot — precedence", () => {
  it("honours PRODUCT override over CATEGORY and GLOBAL", async () => {
    const tx = fakeTx({
      taxRows: [
        { scope: "PRODUCT", scopeId: "prod-1", percentage: 5, isEnabled: true },
        { scope: "CATEGORY", scopeId: "cat-1", percentage: 12, isEnabled: true },
        { scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true },
      ],
    });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 0, quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.lines[0].taxRatePercent).toBe(5);
  });

  it("falls through a disabled PRODUCT override to CATEGORY", async () => {
    const tx = fakeTx({
      taxRows: [
        { scope: "PRODUCT", scopeId: "prod-1", percentage: 5, isEnabled: false },
        { scope: "CATEGORY", scopeId: "cat-1", percentage: 12, isEnabled: true },
        { scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true },
      ],
    });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 0, quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.lines[0].taxRatePercent).toBe(12);
  });
});

describe("resolveOrderConfirmationSnapshot — missing GST configuration blocks confirmation", () => {
  it("returns ok:false with no partial snapshot when no GST setting exists at any tier", async () => {
    const tx = fakeTx({ taxRows: [] });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 10, quantity: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ lineItemId: "line-1", productId: "prod-1", reason: "NO_SETTING_CONFIGURED" }]);
  });

  it("collects errors for ALL unresolved lines, not just the first", async () => {
    const tx = fakeTx({ taxRows: [{ scope: "PRODUCT", scopeId: "prod-1", percentage: 5, isEnabled: true }] });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 0, quantity: 1 },
      { lineItemId: "line-2", productId: "prod-2", categoryId: "cat-2", supplierUnitPrice: 500, markupPercent: 0, quantity: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].lineItemId).toBe("line-2");
  });

  it("never returns a snapshot object when any line fails to resolve", async () => {
    const tx = fakeTx({ taxRows: [] });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 10, quantity: 1 },
    ]);
    expect((result as any).snapshot).toBeUndefined();
  });
});

describe("resolveOrderConfirmationSnapshot — advance configuration", () => {
  it("returns null advancePercent/requiredAdvanceAmount when AdvanceConfig is disabled", async () => {
    const tx = fakeTx({
      taxRows: [{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }],
      advanceConfig: { percentage: 20, isEnabled: false },
    });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 0, quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.advancePercent).toBeNull();
    expect(result.snapshot.requiredAdvanceAmount).toBeNull();
  });

  it("returns null when AdvanceConfig does not exist at all", async () => {
    const tx = fakeTx({
      taxRows: [{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }],
      advanceConfig: null,
    });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 0, quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.advancePercent).toBeNull();
  });

  it("computes the informational required advance from the GST-inclusive final payable when enabled", async () => {
    const tx = fakeTx({
      taxRows: [{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }],
      advanceConfig: { percentage: 20, isEnabled: true },
    });
    const result = await resolveOrderConfirmationSnapshot(tx, [
      { lineItemId: "line-1", productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 1000, markupPercent: 10, quantity: 2 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.advancePercent).toBe(20);
    expect(result.snapshot.requiredAdvanceAmount).toBe(519.2);
  });
});

describe("assertConsistentOrderSnapshot / hasCompleteOrderSnapshot", () => {
  it("accepts a fully-null snapshot (never confirmed)", async () => {
    
    const fields = { taxAmount: null, finalPayableAmount: null, advancePercent: null, requiredAdvanceAmount: null };
    expect(() => assertConsistentOrderSnapshot("order-1", fields)).not.toThrow();
    expect(hasCompleteOrderSnapshot(fields)).toBe(false);
  });

  it("accepts a fully-populated snapshot (confirmed, with advance)", async () => {
    
    const fields = { taxAmount: 396, finalPayableAmount: 2596, advancePercent: 20, requiredAdvanceAmount: 519.2 };
    expect(() => assertConsistentOrderSnapshot("order-1", fields)).not.toThrow();
    expect(hasCompleteOrderSnapshot(fields)).toBe(true);
  });

  it("accepts a confirmed snapshot with advance disabled (null advance fields, non-null payable)", async () => {
    
    const fields = { taxAmount: 396, finalPayableAmount: 2596, advancePercent: null, requiredAdvanceAmount: null };
    expect(() => assertConsistentOrderSnapshot("order-1", fields)).not.toThrow();
    expect(hasCompleteOrderSnapshot(fields)).toBe(true);
  });

  it("throws when taxAmount is set but finalPayableAmount is null (partial snapshot)", async () => {
    
    const fields = { taxAmount: 396, finalPayableAmount: null, advancePercent: null, requiredAdvanceAmount: null };
    expect(() => assertConsistentOrderSnapshot("order-1", fields)).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws when advancePercent is set but requiredAdvanceAmount is null", async () => {
    
    const fields = { taxAmount: 396, finalPayableAmount: 2596, advancePercent: 20, requiredAdvanceAmount: null };
    expect(() => assertConsistentOrderSnapshot("order-1", fields)).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws when advancePercent is set but finalPayableAmount is null", async () => {
    
    const fields = { taxAmount: null, finalPayableAmount: null, advancePercent: 20, requiredAdvanceAmount: 100 };
    expect(() => assertConsistentOrderSnapshot("order-1", fields)).toThrow(InconsistentOrderSnapshotError);
  });
});

describe("assertConsistentOrderItemSnapshot — Phase 4.2 line-item nullability/validity", () => {
  it("accepts a fully-null line (legacy/unconfirmed)", () => {
    expect(() =>
      assertConsistentOrderItemSnapshot("order-1", { lineItemId: "line-1", taxRatePercent: null, taxAmount: null })
    ).not.toThrow();
  });

  it("accepts a fully-populated, valid line", () => {
    expect(() =>
      assertConsistentOrderItemSnapshot("order-1", { lineItemId: "line-1", taxRatePercent: 18, taxAmount: 396 })
    ).not.toThrow();
  });

  it("accepts an explicit 0% line with 0 taxAmount", () => {
    expect(() =>
      assertConsistentOrderItemSnapshot("order-1", { lineItemId: "line-1", taxRatePercent: 0, taxAmount: 0 })
    ).not.toThrow();
  });

  it("throws when taxRatePercent is set but taxAmount is null", () => {
    expect(() =>
      assertConsistentOrderItemSnapshot("order-1", { lineItemId: "line-1", taxRatePercent: 18, taxAmount: null })
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws when taxAmount is set but taxRatePercent is null", () => {
    expect(() =>
      assertConsistentOrderItemSnapshot("order-1", { lineItemId: "line-1", taxRatePercent: null, taxAmount: 396 })
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws on a negative taxAmount", () => {
    expect(() =>
      assertConsistentOrderItemSnapshot("order-1", { lineItemId: "line-1", taxRatePercent: 18, taxAmount: -5 })
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws on a non-finite taxRatePercent", () => {
    expect(() =>
      assertConsistentOrderItemSnapshot("order-1", { lineItemId: "line-1", taxRatePercent: NaN, taxAmount: 10 })
    ).toThrow(InconsistentOrderSnapshotError);
  });
});

describe("assertConsistentOrderSnapshotArithmetic — Phase 4.2 numeric reconciliation", () => {
  it("accepts a correctly-reconciling snapshot with an advance", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 2200,
        taxAmount: 396,
        finalPayableAmount: 2596,
        advancePercent: 20,
        requiredAdvanceAmount: 519.2,
      })
    ).not.toThrow();
  });

  it("accepts a correctly-reconciling snapshot with no advance configured", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 1000,
        taxAmount: 180,
        finalPayableAmount: 1180,
        advancePercent: null,
        requiredAdvanceAmount: null,
      })
    ).not.toThrow();
  });

  it("accepts a valid zero-tax (0% GST) snapshot", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 500,
        taxAmount: 0,
        finalPayableAmount: 500,
        advancePercent: null,
        requiredAdvanceAmount: null,
      })
    ).not.toThrow();
  });

  it("throws when finalPayableAmount does not reconcile with subtotal + taxAmount", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 1000,
        taxAmount: 180,
        finalPayableAmount: 9999,
        advancePercent: null,
        requiredAdvanceAmount: null,
      })
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws when requiredAdvanceAmount does not reconcile with finalPayableAmount * advancePercent / 100", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 1000,
        taxAmount: 180,
        finalPayableAmount: 1180,
        advancePercent: 20,
        requiredAdvanceAmount: 1,
      })
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws on a negative finalPayableAmount", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 1000,
        taxAmount: 180,
        finalPayableAmount: -1180,
        advancePercent: null,
        requiredAdvanceAmount: null,
      })
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws on a non-finite taxAmount", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 1000,
        taxAmount: Infinity,
        finalPayableAmount: 1180,
        advancePercent: null,
        requiredAdvanceAmount: null,
      })
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("tolerates a one-cent rounding drift between sum-of-lines and order-level figures", () => {
    expect(() =>
      assertConsistentOrderSnapshotArithmetic("order-1", {
        subtotal: 1000,
        taxAmount: 180,
        finalPayableAmount: 1180.01,
        advancePercent: null,
        requiredAdvanceAmount: null,
      })
    ).not.toThrow();
  });
});

describe("assertOrderTaxAmountReconcilesWithItems — Phase 4.2 cross-table reconciliation", () => {
  it("accepts when Order.taxAmount equals the sum of OrderItem.taxAmount", () => {
    expect(() =>
      assertOrderTaxAmountReconcilesWithItems("order-1", 396, [{ taxAmount: 198 }, { taxAmount: 198 }])
    ).not.toThrow();
  });

  it("accepts a legacy order (all items null, Order.taxAmount effectively checked as 0)", () => {
    expect(() =>
      assertOrderTaxAmountReconcilesWithItems("order-1", 0, [{ taxAmount: null }, { taxAmount: null }])
    ).not.toThrow();
  });

  it("throws when Order.taxAmount does not equal the sum of OrderItem.taxAmount", () => {
    expect(() =>
      assertOrderTaxAmountReconcilesWithItems("order-1", 500, [{ taxAmount: 198 }, { taxAmount: 198 }])
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("tolerates a one-cent rounding drift", () => {
    expect(() =>
      assertOrderTaxAmountReconcilesWithItems("order-1", 396.01, [{ taxAmount: 198 }, { taxAmount: 198 }])
    ).not.toThrow();
  });
});

describe("assertFullOrderSnapshotIntegrity — Phase 4.4 composed validation", () => {
  it("passes a fully-consistent, confirmed order with matching items", () => {
    expect(() =>
      assertFullOrderSnapshotIntegrity(
        "order-1",
        { totalAmount: 2200, taxAmount: 396, finalPayableAmount: 2596, advancePercent: null, requiredAdvanceAmount: null },
        [{ id: "item-1", taxRatePercent: 18, taxAmount: 396 }]
      )
    ).not.toThrow();
  });

  it("passes an all-null legacy order regardless of item shape (never requires item data for legacy orders)", () => {
    expect(() =>
      assertFullOrderSnapshotIntegrity(
        "order-1",
        { totalAmount: 1000, taxAmount: null, finalPayableAmount: null, advancePercent: null, requiredAdvanceAmount: null },
        [{ id: "item-1", taxRatePercent: null, taxAmount: null }]
      )
    ).not.toThrow();
  });

  it("passes a valid zero-tax confirmed order", () => {
    expect(() =>
      assertFullOrderSnapshotIntegrity(
        "order-1",
        { totalAmount: 500, taxAmount: 0, finalPayableAmount: 500, advancePercent: null, requiredAdvanceAmount: null },
        [{ id: "item-1", taxRatePercent: 0, taxAmount: 0 }]
      )
    ).not.toThrow();
  });

  it("throws when a confirmed order has an item with a null taxAmount (missing line snapshot)", () => {
    expect(() =>
      assertFullOrderSnapshotIntegrity(
        "order-1",
        { totalAmount: 2200, taxAmount: 396, finalPayableAmount: 2596, advancePercent: null, requiredAdvanceAmount: null },
        [{ id: "item-1", taxRatePercent: null, taxAmount: null }]
      )
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws when aggregate item tax does not reconcile with Order.taxAmount", () => {
    expect(() =>
      assertFullOrderSnapshotIntegrity(
        "order-1",
        { totalAmount: 2200, taxAmount: 999, finalPayableAmount: 2596, advancePercent: null, requiredAdvanceAmount: null },
        [{ id: "item-1", taxRatePercent: 18, taxAmount: 396 }]
      )
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws when finalPayableAmount does not reconcile with totalAmount + taxAmount", () => {
    expect(() =>
      assertFullOrderSnapshotIntegrity(
        "order-1",
        { totalAmount: 2200, taxAmount: 396, finalPayableAmount: 9999, advancePercent: null, requiredAdvanceAmount: null },
        [{ id: "item-1", taxRatePercent: 18, taxAmount: 396 }]
      )
    ).toThrow(InconsistentOrderSnapshotError);
  });

  it("throws on a nullness-inconsistent order-level snapshot before even checking items", () => {
    expect(() =>
      assertFullOrderSnapshotIntegrity(
        "order-1",
        { totalAmount: 2200, taxAmount: 396, finalPayableAmount: null, advancePercent: null, requiredAdvanceAmount: null },
        [{ id: "item-1", taxRatePercent: 18, taxAmount: 396 }]
      )
    ).toThrow(InconsistentOrderSnapshotError);
  });
});
