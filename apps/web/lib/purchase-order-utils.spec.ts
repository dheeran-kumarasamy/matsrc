// Verify and Fix PO Generation to Use Accepted Supplier RFQ Price.
//
// Covers buildPurchaseOrderLineItemData (apps/web's builder PO creation
// path, POST /api/builder/purchase-orders) — the sibling implementation to
// apps/api's PurchaseOrdersService.create, which has its own equivalent
// regression tests.

import { describe, it, expect } from "vitest";
import {
  buildPurchaseOrderLineItemData,
  resolveBuyerPoDocumentNumber,
  serializePurchaseOrder,
  isPurchaseOrderEligibleOrderStatus,
} from "./purchase-order-utils";

// Purchase-Order Generation Eligibility (Phase 5B) — mirrors
// apps/api/src/builder/purchase-orders/purchase-orders.service.spec.ts's
// own equivalent tests exactly, since this Next.js route is a separate,
// independent implementation of the identical business rule.
describe("isPurchaseOrderEligibleOrderStatus", () => {
  it("rejects PLACED (not yet confirmed by any path)", () => {
    expect(isPurchaseOrderEligibleOrderStatus("PLACED" as any)).toBe(false);
  });

  it("rejects CANCELLED (the one terminal/rejected status)", () => {
    expect(isPurchaseOrderEligibleOrderStatus("CANCELLED" as any)).toBe(false);
  });

  it("allows PROCESSING, DISPATCHED, OUT_FOR_DELIVERY, and DELIVERED — every status reachable only via a genuine confirmation", () => {
    for (const status of ["PROCESSING", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"]) {
      expect(isPurchaseOrderEligibleOrderStatus(status as any)).toBe(true);
    }
  });
});

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

  // Admin-Configurable Product Markup — this PO is the Buildohub<->SUPPLIER
  // document, so unitPrice/tax must use the ORIGINAL supplier price, never
  // the buyer's marked-up OrderItem.unitPrice.
  it("computes unitPrice/tax from supplierUnitPrice, not the buyer's marked-up unitPrice", () => {
    const result = buildPurchaseOrderLineItemData(
      {
        productId: "p1",
        quantity: 5,
        unitPrice: 1100, // buyer-facing, marked-up price
        supplierUnitPrice: 1000, // original supplier price — must be used here
        markupPercent: 10,
        markupAmount: 100,
        taxRatePercent: 18,
        deliveryDate: null,
      },
      null
    );

    expect(result.unitPrice).toBe(1000); // supplier rate, not 1100
    expect(result.tax).toBe(900); // 5 * 1000 * 18%, not computed from 1100
    expect(result.buyerUnitPrice).toBe(1100);
    expect(result.markupPercent).toBe(10);
    expect(result.markupAmount).toBe(100);
  });

  it("falls back to unitPrice as the supplier rate for legacy rows with no recorded supplierUnitPrice (0% markup)", () => {
    const result = buildPurchaseOrderLineItemData(
      { productId: "p1", quantity: 5, unitPrice: 1000, taxRatePercent: 18, deliveryDate: null },
      null
    );

    expect(result.unitPrice).toBe(1000);
    expect(result.buyerUnitPrice).toBe(1000);
    expect(result.markupPercent).toBe(0);
    expect(result.markupAmount).toBe(0);
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

// Uniform GST on Marked-Up Buyer Price — regression coverage for
// serializePurchaseOrder, the single JSON serialization every builder
// (buyer)-facing PO route (GET list/detail, POST create, PATCH) uses. This
// view must show GST computed on the MARKED-UP buyer price, never the
// original supplier rate persisted on PurchaseOrderLineItem.
function fakePo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "po-1",
    poNumber: "PO-2026-00001",
    status: "ISSUED",
    version: 1,
    notes: null,
    termsSnapshot: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    orderId: "order-1",
    order: { enquiryId: "ABC-SITE01-000001", orderNumber: "OD/2601/00001", status: "PROCESSING", siteId: null, site: null },
    supplier: { id: "sup-1", companyName: "Acme", gstin: null, region: null, user: null },
    builder: { id: "builder-1", name: "Rahul", email: "rahul@example.com", phone: null },
    lineItems: [
      {
        id: "li-1",
        productId: "prod-1",
        product: { name: "Cement", unit: "BAG" },
        quantity: 10,
        unitPrice: 100, // original supplier rate
        buyerUnitPrice: 110, // marked-up buyer rate (10% markup)
        markupPercent: 10,
        markupAmount: 10,
        tax: 180, // supplier-based GST (10 * 100 * 18%)
        taxRatePercent: 18,
        deliveryDate: null,
        fulfilledQuantity: 0,
      },
    ],
    ...overrides,
  };
}

describe("serializePurchaseOrder — Uniform GST on Marked-Up Buyer Price", () => {
  it("computes GST on the marked-up buyer price, not the original supplier value", () => {
    const result = serializePurchaseOrder(fakePo());

    // Buyer rate 110 * 18% = 19.80 per unit * 10 qty = 198 (never 180, the
    // supplier-based figure computed at PO-generation time).
    expect(result.lineItems[0].tax).toBe(198);
    expect(result.taxAmount).toBe(198);
  });

  it("never calculates GST on the original supplier value when it differs from the marked-up value", () => {
    const result = serializePurchaseOrder(fakePo());
    expect(result.lineItems[0].tax).not.toBe(180);
  });

  it("applies markup and GST exactly once: subtotal/tax/total all derive from the SAME single buyerUnitPrice", () => {
    const result = serializePurchaseOrder(fakePo());

    expect(result.subtotal).toBe(1100); // 10 * 110
    expect(result.taxAmount).toBe(198); // 1100 * 18%
    expect(result.total).toBe(1298); // 1100 + 198
    expect(result.lineItems[0].lineTotal).toBe(1298);
  });

  it("produces the correct GST calculation on the resulting buyer price for a 0% markup line", () => {
    const result = serializePurchaseOrder(
      fakePo({
        lineItems: [
          {
            id: "li-1",
            productId: "prod-1",
            product: { name: "Cement", unit: "BAG" },
            quantity: 10,
            unitPrice: 100,
            buyerUnitPrice: 100, // 0% markup
            markupPercent: 0,
            markupAmount: 0,
            tax: 180,
            taxRatePercent: 18,
            deliveryDate: null,
            fulfilledQuantity: 0,
          },
        ],
      })
    );

    expect(result.lineItems[0].tax).toBe(180); // 10 * 100 * 18% (same basis when markup is 0%)
    expect(result.total).toBe(1180);
  });

  it("handles different configured markup percentages and GST rates correctly across multiple lines", () => {
    const result = serializePurchaseOrder(
      fakePo({
        lineItems: [
          {
            id: "li-1",
            productId: "prod-1",
            product: { name: "Cement", unit: "BAG" },
            quantity: 10,
            unitPrice: 100,
            buyerUnitPrice: 110, // 10% markup
            markupPercent: 10,
            markupAmount: 10,
            tax: 180,
            taxRatePercent: 18,
            deliveryDate: null,
            fulfilledQuantity: 0,
          },
          {
            id: "li-2",
            productId: "prod-2",
            product: { name: "Steel", unit: "KG" },
            quantity: 50,
            unitPrice: 60,
            buyerUnitPrice: 75, // 25% markup
            markupPercent: 25,
            markupAmount: 15,
            tax: 150, // supplier-based, 50 * 60 * 5%
            taxRatePercent: 5,
            deliveryDate: null,
            fulfilledQuantity: 0,
          },
        ],
      })
    );

    // Line 1: 10 * 110 = 1100 @ 18% = 198.
    expect(result.lineItems[0].tax).toBe(198);
    // Line 2: 50 * 75 = 3750 @ 5% = 187.5.
    expect(result.lineItems[1].tax).toBe(187.5);
    expect(result.subtotal).toBe(1100 + 3750);
    expect(result.taxAmount).toBe(198 + 187.5);
    expect(result.total).toBe(1100 + 198 + 3750 + 187.5);
  });

  it("preserves the original supplier unitPrice/tax separately under their own field names, never overwritten", () => {
    const result = serializePurchaseOrder(fakePo());

    expect(result.lineItems[0].originalUnitPrice).toBe(100);
    expect(result.lineItems[0].originalTax).toBe(180);
  });

  it("fails safe to the DEFAULT_TAX_RATE_PERCENT (18%) when taxRatePercent is missing, never fabricating a different rate", () => {
    const result = serializePurchaseOrder(
      fakePo({
        lineItems: [
          {
            id: "li-1",
            productId: "prod-1",
            product: { name: "Cement", unit: "BAG" },
            quantity: 10,
            unitPrice: 100,
            buyerUnitPrice: 110,
            markupPercent: 10,
            markupAmount: 10,
            tax: 180,
            taxRatePercent: null,
            deliveryDate: null,
            fulfilledQuantity: 0,
          },
        ],
      })
    );

    expect(result.lineItems[0].taxRatePercent).toBe(18);
    expect(result.lineItems[0].tax).toBe(198); // 10 * 110 * 18%
  });

  it("falls back to unitPrice (0% markup) for legacy lines with no recorded buyerUnitPrice", () => {
    const result = serializePurchaseOrder(
      fakePo({
        lineItems: [
          {
            id: "li-1",
            productId: "prod-1",
            product: { name: "Cement", unit: "BAG" },
            quantity: 10,
            unitPrice: 100,
            buyerUnitPrice: null,
            markupPercent: null,
            markupAmount: null,
            tax: 180,
            taxRatePercent: 18,
            deliveryDate: null,
            fulfilledQuantity: 0,
          },
        ],
      })
    );

    expect(result.lineItems[0].unitPrice).toBe(100);
    expect(result.lineItems[0].tax).toBe(180);
    expect(result.lineItems[0].markupPercent).toBe(0);
  });
});
