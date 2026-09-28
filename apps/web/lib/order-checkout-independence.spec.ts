// Regression coverage for §8/§9 of the PO quantity-change task spec:
// creating a new enquiry (via the AI Sourcing Assistant's confirm step,
// which calls this SAME shared `createOrdersFromCart` pipeline used by cart
// checkout — see order-checkout.ts's own header comment) must:
//   1. create a brand-new Order (a new enquiry), never reuse an existing id
//   2. never call `order.update` on any existing order — in particular,
//      never automatically cancel/modify the builder's original order
//   3. never touch PurchaseOrder/PurchaseOrderLineItem at all
//
// Prisma and the outbound supplier-listings fetch are mocked (same pattern
// as lib/sourcing/session-authorization.spec.ts) so this runs with no real
// database/network call. This intentionally does NOT duplicate the full
// checkout/sourcing test suites — it only proves the independence property.

import { beforeEach, describe, expect, it, vi } from "vitest";

const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const orderCreate = vi.fn();
const orderUpdate = vi.fn();
const purchaseOrderUpdate = vi.fn();
const purchaseOrderLineItemUpdate = vi.fn();
const priceSnapshotCreate = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    cartItem: {
      findMany: (...args: unknown[]) => cartItemFindMany(...args),
      deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
    },
    site: { findFirst: (...args: unknown[]) => siteFindFirst(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    order: {
      create: (...args: unknown[]) => orderCreate(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
    },
    purchaseOrder: { update: (...args: unknown[]) => purchaseOrderUpdate(...args) },
    purchaseOrderLineItem: { update: (...args: unknown[]) => purchaseOrderLineItemUpdate(...args) },
    priceSnapshot: { create: (...args: unknown[]) => priceSnapshotCreate(...args) },
    $transaction: (callback: any) => callback({ order: { create: orderCreate } }),
  },
  resolveUnitPrice: () => 100,
}));

vi.mock("@/lib/notify", () => ({
  notifySupplierOrderSubmitted: vi.fn().mockResolvedValue(undefined),
}));

// generateEnquiryId's own internals (builder/site code resolution, the
// row-locked sequence counter) are covered elsewhere and are irrelevant to
// this independence test — stub it directly so the transaction mock above
// doesn't need to fake every model it touches.
vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    generateEnquiryId: vi.fn().mockResolvedValue("NEW-SITE01-000002"),
  };
});

const ORIGINAL_ORDER_ID = "order-original-untouched";
const NEW_ORDER_ID = "order-new-enquiry";
const USER_ID = "builder-1";

beforeEach(() => {
  cartItemFindMany.mockReset();
  cartItemDeleteMany.mockReset();
  siteFindFirst.mockReset();
  userFindUnique.mockReset();
  orderCreate.mockReset();
  orderUpdate.mockReset();
  purchaseOrderUpdate.mockReset();
  purchaseOrderLineItemUpdate.mockReset();
  priceSnapshotCreate.mockReset();
  priceSnapshotCreate.mockResolvedValue({});
  cartItemDeleteMany.mockResolvedValue({ count: 1 });

  // No live public listing resolves — forces the legacy per-item fallback
  // pricing path, keeping this test independent of the listings fetch.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, headers: { get: () => "application/json" } })
  );

  cartItemFindMany.mockResolvedValue([
    {
      productId: "product-1",
      quantity: 999, // a DIFFERENT quantity from the original order — never inherited
      product: {
        supplierId: "supplier-1",
        canonicalProductId: null,
        basePrice: 100,
        supplier: { companyName: "Acme Supplier" },
        pricingTiers: [],
      },
    },
  ]);

  siteFindFirst.mockResolvedValue({ id: "site-1" });
  userFindUnique.mockResolvedValue({ name: "Builder", email: "builder@example.com" });

  orderCreate.mockResolvedValue({
    id: NEW_ORDER_ID,
    enquiryId: "NEW-SITE01-000002",
    status: "PLACED",
    totalAmount: 99900,
    items: [{ id: "item-1" }],
  });
});

describe("createOrdersFromCart — new enquiry independence (§8/§9)", () => {
  it("creates a brand-new order/enquiry and never updates the original order or any PurchaseOrder", async () => {
    const { createOrdersFromCart } = await import("./order-checkout");

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1. A NEW order/enquiry was created, distinct from the original.
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(result.orders[0].id).toBe(NEW_ORDER_ID);
    expect(result.orders[0].id).not.toBe(ORIGINAL_ORDER_ID);

    // 2. The original order is never read or written by this pipeline —
    //    order.update is never called at all (no automatic cancellation,
    //    no quantity mutation of any existing order).
    expect(orderUpdate).not.toHaveBeenCalled();

    // 3. The confirmed PO/PO line items are completely untouched.
    expect(purchaseOrderUpdate).not.toHaveBeenCalled();
    expect(purchaseOrderLineItemUpdate).not.toHaveBeenCalled();
  });
});
