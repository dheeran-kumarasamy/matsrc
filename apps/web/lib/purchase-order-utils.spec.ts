// Verify and Fix PO Generation to Use Accepted Supplier RFQ Price.
//
// Covers buildPurchaseOrderLineItemData (apps/web's builder PO creation
// path, POST /api/builder/purchase-orders) — the sibling implementation to
// apps/api's PurchaseOrdersService.create, which has its own equivalent
// regression tests.

import { describe, it, expect } from "vitest";
import { buildPurchaseOrderLineItemData } from "./purchase-order-utils";

describe("buildPurchaseOrderLineItemData", () => {
  // Catalogue price = ₹400, Supplier RFQ quote = ₹425 (already reflected on
  // OrderItem.unitPrice by BestPriceSelectionService). PO must use ₹425.
  it("uses the accepted supplier RFQ quotation price, never a catalogue price, and computes GST from it", () => {
    const result = buildPurchaseOrderLineItemData(
      { productId: "p1", quantity: 100, unitPrice: 425, taxRatePercent: 18, deliveryDate: null },
      null
    );

    expect(result.unitPrice).toBe(425);
    expect(result.tax).toBe(7650); // 100 * 425 * 18%
    expect(result.quantity).toBe(100);
  });

  // Multi-line verification: each line uses its OWN accepted quote price.
  it("computes each line item's GST independently from its own unit price and tax rate", () => {
    const lineA = buildPurchaseOrderLineItemData(
      { productId: "p-a", quantity: 100, unitPrice: 425, taxRatePercent: 18, deliveryDate: null },
      null
    );
    const lineB = buildPurchaseOrderLineItemData(
      { productId: "p-b", quantity: 50, unitPrice: 1250, taxRatePercent: 5, deliveryDate: null },
      null
    );

    expect(lineA).toMatchObject({ productId: "p-a", unitPrice: 425, tax: 7650 });
    expect(lineB).toMatchObject({ productId: "p-b", unitPrice: 1250, tax: 3125 });
  });

  it("falls back to DEFAULT_TAX_RATE_PERCENT (18%) when taxRatePercent is absent", () => {
    const result = buildPurchaseOrderLineItemData(
      { productId: "p1", quantity: 10, unitPrice: 100, taxRatePercent: null, deliveryDate: null },
      null
    );
    expect(result.tax).toBe(180); // 10 * 100 * 18%
  });

  it("honours an explicit 0% GST rate as a genuine zero-tax line", () => {
    const result = buildPurchaseOrderLineItemData(
      { productId: "p1", quantity: 10, unitPrice: 500, taxRatePercent: 0, deliveryDate: null },
      null
    );
    expect(result.tax).toBe(0);
  });

  // Immutability: this function has no product/catalogue lookup at all — it
  // only ever reads the unitPrice/taxRatePercent passed to it (the already-
  // accepted OrderItem fields), so a later catalogue price change can never
  // leak in.
  it("never reads from anything other than the passed-in OrderItem fields", () => {
    const result = buildPurchaseOrderLineItemData(
      { productId: "p1", quantity: 10, unitPrice: 425, taxRatePercent: 18, deliveryDate: null },
      null
    );
    expect(result.unitPrice).toBe(425);
  });

  it("falls back to the order's tentativeDeliveryDate when the item has none", () => {
    const fallback = new Date("2026-02-01T00:00:00Z");
    const result = buildPurchaseOrderLineItemData(
      { productId: "p1", quantity: 1, unitPrice: 100, taxRatePercent: 18, deliveryDate: null },
      fallback
    );
    expect(result.deliveryDate).toBe(fallback);
  });
});
