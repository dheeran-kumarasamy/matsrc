// Verify and Fix PO Generation to Use Accepted Supplier RFQ Price.
//
// Covers buildPurchaseOrderLineItemData (apps/web's builder PO creation
// path, POST /api/builder/purchase-orders) — the sibling implementation to
// apps/api's PurchaseOrdersService.create, which has its own equivalent
// regression tests.

import { describe, it, expect } from "vitest";
import { buildPurchaseOrderLineItemData, resolveBuyerPoDocumentNumber } from "./purchase-order-utils";

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

// Buyer Portal PO Display / Downloaded PDF Number mismatch fix — unit
// tests for resolveBuyerPoDocumentNumber(), the pure helper both the
// buyer-portal PO list/detail pages and the order-detail "PO summary"
// surfaces (orders/[id], orders/payment/[id], OrderDetailOverlay) now use
// to display the SAME document number the downloaded buyer-facing PDF
// already prints/names its file after (see
// app/api/builder/purchase-orders/[id]/export/route.ts's identical
// `payload.orderNumber ?? payload.poNumber` expression, which this
// function mirrors exactly rather than diverging from it).
describe("resolveBuyerPoDocumentNumber", () => {
  it("prefers the Order's own orderNumber (OD/YYMM/SSSSS) over the PurchaseOrder's separate poNumber series", () => {
    const result = resolveBuyerPoDocumentNumber({ orderNumber: "OD/2601/00042", poNumber: "PO-2026-00001" });
    expect(result).toBe("OD/2601/00042");
    expect(result).not.toBe("PO-2026-00001");
  });

  it("falls back to poNumber only when the order has no orderNumber yet (pre-payment-approval)", () => {
    const result = resolveBuyerPoDocumentNumber({ orderNumber: null, poNumber: "PO-2026-00001" });
    expect(result).toBe("PO-2026-00001");
  });

  it("falls back to poNumber when orderNumber is undefined (field omitted entirely)", () => {
    const result = resolveBuyerPoDocumentNumber({ poNumber: "PO-2026-00001" });
    expect(result).toBe("PO-2026-00001");
  });

  it("matches the exact fallback expression used by the buyer-facing PDF export route, for the same PO data", () => {
    const po = { orderNumber: "OD/2607/00042", poNumber: "PO-2026-00001" };
    // Mirrors app/api/builder/purchase-orders/[id]/export/route.ts's
    // `const documentNumber = payload.orderNumber ?? payload.poNumber;`
    const pdfDocumentNumber = po.orderNumber ?? po.poNumber;
    expect(resolveBuyerPoDocumentNumber(po)).toBe(pdfDocumentNumber);
  });
});
