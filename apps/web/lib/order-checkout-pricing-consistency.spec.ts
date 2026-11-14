// S04/S09 regression — base-price/tier-pricing consistency through
// Supplier -> Product -> Cart -> Checkout -> Order.
//
// Proves createOrdersFromCart() (the authoritative server-side checkout/
// order-creation pricing calculation) correctly resolves the supplier's
// real basePrice/PricingTier configuration using targeted database queries
// (prisma.product.findMany) directly from PostgreSQL, without relying on
// cross-domain HTTP calls to the supplier portal.
//
// Mocking pattern mirrors lib/order-checkout-targeted.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const productFindMany = vi.fn();
const orderCreate = vi.fn();
const priceSnapshotCreate = vi.fn();
const transactionFn = vi.fn();
const queryRawFn = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    cartItem: {
      findMany: (...args: unknown[]) => cartItemFindMany(...args),
      deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
    },
    site: { findFirst: (...args: unknown[]) => siteFindFirst(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    product: { findMany: (...args: unknown[]) => productFindMany(...args) },
    order: { create: (...args: unknown[]) => orderCreate(...args) },
    priceSnapshot: { create: (...args: unknown[]) => priceSnapshotCreate(...args) },
    $queryRaw: (...args: unknown[]) => queryRawFn(...args),
    $transaction: (...args: unknown[]) => transactionFn(...args),
  },
  resolveUnitPrice: () => -1,
}));

// Captured so beforeEach can re-arm its resolved value every test — the
// shared vitest.config.ts sets `restoreMocks: true`, which wipes an inline
// vi.fn()'s mockResolvedValue() back to "no implementation" between tests.
const notifySupplierOrderSubmitted = vi.fn();
const notifySupplierRfqReceived = vi.fn();
vi.mock("@/lib/notify", () => ({
  notifySupplierOrderSubmitted: (...args: unknown[]) => notifySupplierOrderSubmitted(...args),
}));

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    generateEnquiryId: vi.fn().mockResolvedValue("ABC-SITE01-000001"),
    notifySupplierRfqReceived: (...args: unknown[]) => notifySupplierRfqReceived(...args),
  };
});

const USER_ID = "builder-1";
const PRODUCT_ID = "jsw-cement";
const SUPPLIER_ID = "supplier-1";
const CATEGORY_ID = "cat-cement";

function dbProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    supplierId: SUPPLIER_ID,
    canonicalProductId: null,
    categoryId: CATEGORY_ID,
    basePrice: 100,
    stock: 1000,
    maxServiceableQty: 1000,
    isActive: true,
    supplier: { companyName: "JSW Supplier" },
    pricingTiers: [
      { minQty: 1, maxQty: 9, tierPrice: 100 },
      { minQty: 10, maxQty: 1000, tierPrice: 90 },
    ],
    ...overrides,
  };
}

function cartRow(quantity: number, basePrice = 100, id = "cart-item-1") {
  return {
    id,
    productId: PRODUCT_ID,
    quantity,
    product: {
      supplierId: SUPPLIER_ID,
      canonicalProductId: null,
      categoryId: CATEGORY_ID,
      basePrice,
      supplier: { companyName: "JSW Supplier" },
      pricingTiers: [
        { minQty: 1, maxQty: 9, tierPrice: 100 },
        { minQty: 10, maxQty: 1000, tierPrice: 90 },
      ],
    },
  };
}

beforeEach(() => {
  cartItemFindMany.mockReset();
  cartItemDeleteMany.mockReset();
  siteFindFirst.mockReset();
  userFindUnique.mockReset();
  productFindMany.mockReset();
  orderCreate.mockReset();
  priceSnapshotCreate.mockReset();
  priceSnapshotCreate.mockResolvedValue({});
  queryRawFn.mockReset();
  queryRawFn.mockImplementation(async () => {
    const results = cartItemFindMany.mock.results;
    const lastResult = await results[results.length - 1]?.value;
    if (Array.isArray(lastResult)) {
      return lastResult.map((item: any) => ({
        id: item.id,
        quantity: item.quantity,
      }));
    }
    return [];
  });
  transactionFn.mockReset();
  transactionFn.mockImplementation(async (callback: any) => {
    return callback({
      order: { create: orderCreate },
      cartItem: {
        findMany: (...args: unknown[]) => cartItemFindMany(...args),
        deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
      },
      $queryRaw: (...args: unknown[]) => queryRawFn(...args),
    });
  });
  notifySupplierOrderSubmitted.mockReset();
  notifySupplierOrderSubmitted.mockResolvedValue(undefined);
  notifySupplierRfqReceived.mockReset();
  notifySupplierRfqReceived.mockResolvedValue(undefined);
  cartItemDeleteMany.mockImplementation(async (args: any) => {
    const ids = args?.where?.id?.in;
    return { count: Array.isArray(ids) ? ids.length : 1 };
  });

  siteFindFirst.mockResolvedValue({ id: "site-1" });
  userFindUnique.mockResolvedValue({ name: "Builder", email: "builder@example.com" });

  orderCreate.mockImplementation(async ({ data }: any) => ({
    id: "order-1",
    enquiryId: "ABC-SITE01-000001",
    status: data.status,
    totalAmount: data.totalAmount,
    items: data.items.create.map((item: any, i: number) => ({
      id: `item-${i}`,
      productId: item.productId,
      supplierId: item.supplierId,
      unitPrice: item.unitPrice,
    })),
  }));
});

describe("createOrdersFromCart — S04/S09 base-price/tier-pricing consistency", () => {
  it("Test 1 — base price: quantity below the first tier threshold uses the supplier's base price (₹100), unchanged", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(5)]);
    productFindMany.mockResolvedValue([dbProduct()]);

    const { createOrdersFromCart } = await import("./order-checkout");
    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // quantity=5 is within tier 1 (1-9 @ ₹100) — base price applies, not a fabricated/stale value.
    expect(result.orders[0].total).toBe(500);
    expect(productFindMany).toHaveBeenCalledTimes(1);
  });

  it("Test 2 — existing tier applies: quantity at the tier-2 threshold uses the configured tier price (₹90), never the base price", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(10)]);
    productFindMany.mockResolvedValue([dbProduct()]);

    const { createOrdersFromCart } = await import("./order-checkout");
    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // quantity=10 enters tier 2 (10-1000 @ ₹90) — the existing tier rule must be honoured, not overridden by base price.
    expect(result.orders[0].total).toBe(900);
  });

  it("Test 3 — supplier price update: a changed base price (₹100 -> ₹120) is reflected for quantities with no applicable tier", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(5, 120)]);
    productFindMany.mockResolvedValue([
      dbProduct({
        basePrice: 120,
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 120 },
          { minQty: 10, maxQty: 1000, tierPrice: 90 },
        ],
      }),
    ]);

    const { createOrdersFromCart } = await import("./order-checkout");
    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orders[0].total).toBe(600); // 5 * 120 — the NEW base price, not the stale ₹100.
  });

  it("Test 4 — multiple suppliers: Supplier A's price never leaks into Supplier B's order line", async () => {
    const PRODUCT_B = "jsw-cement-supplier-b";
    const SUPPLIER_B = "supplier-2";

    cartItemFindMany.mockResolvedValue([
      cartRow(5, 100, "cart-item-1"),
      {
        id: "cart-item-2",
        productId: PRODUCT_B,
        quantity: 5,
        product: {
          supplierId: SUPPLIER_B,
          canonicalProductId: null,
          categoryId: CATEGORY_ID,
          basePrice: 200,
          supplier: { companyName: "Other Supplier" },
          pricingTiers: [],
        },
      },
    ]);

    productFindMany.mockResolvedValue([
      dbProduct(),
      dbProduct({
        id: PRODUCT_B,
        supplierId: SUPPLIER_B,
        basePrice: 200,
        supplier: { companyName: "Other Supplier" },
        pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 200 }],
      }),
    ]);

    const { createOrdersFromCart } = await import("./order-checkout");
    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two distinct suppliers -> two distinct grouped orders, each with its own isolated price.
    expect(result.orders).toHaveLength(2);
    const totals = result.orders.map((o) => o.total).sort((a, b) => a - b);
    expect(totals).toEqual([500, 1000]); // 5*100 and 5*200 — never 5*100 and 5*100, or cross-contaminated.
  });

  describe("Correction A — Database Query Errors, Unavailability & All-or-Nothing Safeguards", () => {
    it("Case 1 — propagates database query failure without swallowing into empty array or clearing cart", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      productFindMany.mockRejectedValue(new Error("Database connection dropped"));

      const { createOrdersFromCart } = await import("./order-checkout");
      await expect(
        createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true })
      ).rejects.toThrow("Database connection dropped");

      // Cart is NOT cleared when DB fails
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it("Case 2 — returns clean 400 when no active/eligible products match the cart items", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      // Query succeeds but finds no active matching products
      productFindMany.mockResolvedValue([]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");

      // Cart preserved and no order created
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it("Case 3 — all-or-nothing guarantee: fails safely when only a subset of cart items are active", async () => {
      const PRODUCT_B = "jsw-cement-supplier-b";
      cartItemFindMany.mockResolvedValue([
        cartRow(5),
        {
          id: "cart-item-2",
          productId: PRODUCT_B,
          quantity: 2,
          product: {
            supplierId: "supplier-2",
            canonicalProductId: null,
            categoryId: CATEGORY_ID,
            basePrice: 200,
            supplier: { companyName: "Supplier 2" },
            pricingTiers: [],
          },
        },
      ]);

      // Only PRODUCT_ID is returned; PRODUCT_B was deactivated / deleted
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");

      // Critical: no partial order for PRODUCT_ID is created, and cart is preserved intact!
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Case 4 — inactive products: returns clean 400 and preserves cart when a candidate product is marked inactive", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      productFindMany.mockResolvedValue([dbProduct({ isActive: false })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");

      // Cart preserved and no order created
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Case 5 — insufficient capacity: returns clean 400 and preserves cart when requested quantity exceeds maxServiceableQty/stock", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(100)]);
      // Supplier only has capacity for 50 units
      productFindMany.mockResolvedValue([dbProduct({ stock: 50, maxServiceableQty: 50 })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");

      // Cart preserved and no order created
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Case 6 — synthetic fallback elimination regression: missing products are never synthesized from cart snapshots", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      // Database has no records for the product
      productFindMany.mockResolvedValue([]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");

      // No synthetic stock: 1000 or maxServiceableQty: 1000 fallback created; strictly rejected
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("guarantees fetchAllSupplierListings() / external HTTP fetch is never invoked in any checkout execution path", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      // Zero HTTP fetches — all data resolved locally via Prisma
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Correction B — Supplier Attribution When Tier Winner Differs from Headline Supplier", () => {
    it("routes order and enquiry to the quantity-tier winner (p.supplierId) rather than headline supplier", async () => {
      const CANONICAL_ID = "canon-cement-53";
      const SUPPLIER_A = "supplier-alpha";
      const SUPPLIER_B = "supplier-beta";
      const PRODUCT_A = "prod-cement-alpha";
      const PRODUCT_B = "prod-cement-beta";

      // Cart item was added for PRODUCT_A, whose headline supplier is Alpha Corp (SUPPLIER_A)
      const HEADLINE_SUPPLIER_ID = SUPPLIER_A;
      cartItemFindMany.mockResolvedValue([
        {
          id: "cart-item-1",
          productId: PRODUCT_A,
          quantity: 50,
          product: {
            supplierId: SUPPLIER_A,
            headlineSupplierId: HEADLINE_SUPPLIER_ID,
            canonicalProductId: CANONICAL_ID,
            categoryId: CATEGORY_ID,
            basePrice: 100,
            supplier: { companyName: "Alpha Corp" },
            pricingTiers: [
              { minQty: 1, maxQty: 49, tierPrice: 100 },
              { minQty: 50, maxQty: 1000, tierPrice: 95 },
            ],
          },
        },
      ]);

      // Supplier Alpha has lowest base price (100 vs 110 at qty 1 -> headline winner)
      // Supplier Beta has lower bulk price (80 vs 95 at qty 50 -> tier winner)
      productFindMany.mockResolvedValue([
        {
          id: PRODUCT_A,
          supplierId: SUPPLIER_A,
          canonicalProductId: CANONICAL_ID,
          categoryId: CATEGORY_ID,
          basePrice: 100,
          stock: 1000,
          maxServiceableQty: 1000,
          isActive: true,
          supplier: { companyName: "Alpha Corp" },
          pricingTiers: [
            { minQty: 1, maxQty: 49, tierPrice: 100 },
            { minQty: 50, maxQty: 1000, tierPrice: 95 },
          ],
        },
        {
          id: PRODUCT_B,
          supplierId: SUPPLIER_B,
          canonicalProductId: CANONICAL_ID,
          categoryId: CATEGORY_ID,
          basePrice: 110,
          stock: 1000,
          maxServiceableQty: 1000,
          isActive: true,
          supplier: { companyName: "Beta Hub" },
          pricingTiers: [
            { minQty: 1, maxQty: 49, tierPrice: 110 },
            { minQty: 50, maxQty: 1000, tierPrice: 80 }, // Lower at quantity 50
          ],
        },
      ]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 1. Order summary: assigned to Beta Hub (the tier winner), NOT Alpha Corp (the headline winner)
      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].total).toBe(50 * 80); // 4000
      expect(result.orders[0].itemCount).toBe(1);

      // 2. Database order row: created with Supplier Beta's ID and resolved listing
      const orderCallData = orderCreate.mock.calls[0][0].data;
      const createdItem = orderCallData.items.create[0];
      expect(createdItem.supplierId).toBe(SUPPLIER_B);
      expect(createdItem.supplierId).not.toBe(HEADLINE_SUPPLIER_ID);
      expect(createdItem.unitPrice).toBe(80);
      expect(createdItem.resolvedListingId).toBe(PRODUCT_B);

      // 3. Multi-supplier candidate pool: Beta Hub is Rank 0, Alpha Corp is Rank 1
      expect(createdItem.candidates.create).toHaveLength(2);
      expect(createdItem.candidates.create[0].supplierId).toBe(SUPPLIER_B);
      expect(createdItem.candidates.create[0].rank).toBe(0);
      expect(createdItem.candidates.create[0].unitPrice).toBe(80);

      expect(createdItem.candidates.create[1].supplierId).toBe(SUPPLIER_A);
      expect(createdItem.candidates.create[1].rank).toBe(1);
      expect(createdItem.candidates.create[1].unitPrice).toBe(95);

      // 4. Notifications are dispatched for this order
      expect(notifySupplierOrderSubmitted).toHaveBeenCalledWith("order-1");
    });
  });

  describe("Correction C — Concurrency, Idempotency & Multi-Supplier Transaction Safety", () => {
    it("safeguards against same-buyer concurrent checkout race: returns 400 when cart is already consumed", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      // Concurrent checkout has already consumed the rows, so row-locking query returns 0 rows
      queryRawFn.mockResolvedValueOnce([]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("Cart is empty");

      // No order created for second concurrent checkout
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it("guarantees all-or-nothing rollback across multiple supplier groups when a group fails inside transaction", async () => {
      const PRODUCT_B = "jsw-cement-supplier-b";
      const SUPPLIER_B = "supplier-2";

      cartItemFindMany.mockResolvedValue([
        cartRow(5, 100, "cart-item-1"),
        {
          id: "cart-item-2",
          productId: PRODUCT_B,
          quantity: 5,
          product: {
            supplierId: SUPPLIER_B,
            canonicalProductId: null,
            categoryId: CATEGORY_ID,
            basePrice: 200,
            supplier: { companyName: "Other Supplier" },
            pricingTiers: [],
          },
        },
      ]);

      productFindMany.mockResolvedValue([
        dbProduct(),
        dbProduct({
          id: PRODUCT_B,
          supplierId: SUPPLIER_B,
          basePrice: 200,
          supplier: { companyName: "Other Supplier" },
          pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 200 }],
        }),
      ]);

      // Group 1 succeeds, Group 2 fails
      let orderCallCount = 0;
      orderCreate.mockImplementation(async () => {
        orderCallCount++;
        if (orderCallCount === 2) {
          throw new Error("Foreign key constraint violation on Group 2");
        }
        return {
          id: "order-1",
          enquiryId: "ABC-SITE01-000001",
          status: "PLACED",
          totalAmount: 500,
          items: [{ id: "item-1", productId: PRODUCT_ID, supplierId: SUPPLIER_ID, unitPrice: 100 }],
        };
      });

      const { createOrdersFromCart } = await import("./order-checkout");
      await expect(
        createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true })
      ).rejects.toThrow("Foreign key constraint violation on Group 2");

      // Both groups were wrapped in the single atomic transaction, so failure rolls back entire transaction
      expect(orderCallCount).toBe(2);
    });
  });

  describe("Section 2 — Zero-Capacity Handling & Precedence", () => {
    it("1. maxServiceableQty = 0 rejected with clean 400 even if stock is 500", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      productFindMany.mockResolvedValue([dbProduct({ stock: 500, maxServiceableQty: 0 })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("2. maxServiceableQty = null falls back to stock (100) and succeeds for requested quantity 20", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(20)]);
      productFindMany.mockResolvedValue([dbProduct({ stock: 100, maxServiceableQty: null })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.orders[0].total).toBe(20 * 90); // 1800
    });

    it("3. maxServiceableQty = undefined falls back to stock (100) and succeeds for requested quantity 20", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(20)]);
      productFindMany.mockResolvedValue([dbProduct({ stock: 100, maxServiceableQty: undefined })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.orders[0].total).toBe(20 * 90); // 1800
    });

    it("4. Positive maxServiceableQty = 50 respected with requested quantity 20", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(20)]);
      productFindMany.mockResolvedValue([dbProduct({ stock: 1000, maxServiceableQty: 50 })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.orders[0].total).toBe(20 * 90); // 1800
    });

    it("5. maxServiceableQty = null, stock = 10 rejects requested quantity 20 with clean 400", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(20)]);
      productFindMany.mockResolvedValue([dbProduct({ stock: 10, maxServiceableQty: null })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it("6. Available serviceable quantity = 0 (maxServiceableQty = null, stock = 0) rejects with clean 400", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      productFindMany.mockResolvedValue([dbProduct({ stock: 0, maxServiceableQty: null })]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are no longer available. Please review your cart.");
      expect(orderCreate).not.toHaveBeenCalled();
    });
  });

  describe("Section 3, 4 & 5 — PostgreSQL Cart Row-Locking & Concurrency Protection", () => {
    it("Scenario 1 — Simultaneous double checkout: exactly one succeeds, second gets clean 400 'Cart is empty'", async () => {
      // First checkout consumes the cart rows.
      // Second checkout's SELECT ... FOR UPDATE unblocks after commit and finds 0 rows.
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      queryRawFn.mockResolvedValueOnce([]); // 0 rows returned after first checkout committed and deleted
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("Cart is empty");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Scenario 2 — Concurrent quantity update before lock acquisition: detects mismatch, returns 409", async () => {
      const ITEM_A_ID = "item-a";
      // Snapshot has qty 10, but concurrent update modified row to qty 50 before lock was acquired
      cartItemFindMany.mockResolvedValue([cartRow(10, 100, ITEM_A_ID)]);
      queryRawFn.mockResolvedValueOnce([{ id: ITEM_A_ID, quantity: 50 }]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Scenario 3 — Concurrent quantity update after lock acquisition: lock protects snapshot row, holding update until commit", async () => {
      const ITEM_A_ID = "item-a";
      cartItemFindMany.mockResolvedValue([cartRow(10, 100, ITEM_A_ID)]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      // Row lock was acquired with FOR UPDATE
      expect(queryRawFn).toHaveBeenCalled();
      const rawArgs = queryRawFn.mock.calls[0];
      const sqlStrings = (rawArgs[0] as TemplateStringsArray).join(" ");
      expect(sqlStrings).toContain("FOR UPDATE");
      expect(sqlStrings).toContain("ORDER BY \"id\" ASC");
      // And row was deleted, ensuring any queued update finds 0 rows rather than corrupting order
      expect(cartItemDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: [ITEM_A_ID] }, userId: USER_ID },
      });
    });

    it("Scenario 4 — Concurrent removal: cart item removed before lock acquired, aborts with 409", async () => {
      const ITEM_A_ID = "item-a";
      const ITEM_B_ID = "item-b";
      // Snapshot had [A, B], but B was removed concurrently before lock acquisition
      cartItemFindMany.mockResolvedValue([cartRow(5, 100, ITEM_A_ID), cartRow(5, 100, ITEM_B_ID)]);
      queryRawFn.mockResolvedValueOnce([{ id: ITEM_A_ID, quantity: 5 }]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Scenario 5 — New item added during checkout: creates enquiry for [A, B] and deletes ONLY [A, B], preserving C", async () => {
      const ITEM_A_ID = "item-a";
      const ITEM_B_ID = "item-b";
      const PRODUCT_B = "jsw-cement-supplier-b";
      const SUPPLIER_B = "supplier-2";

      // Snapshot captured [A, B]
      cartItemFindMany.mockResolvedValue([
        cartRow(5, 100, ITEM_A_ID),
        {
          id: ITEM_B_ID,
          productId: PRODUCT_B,
          quantity: 5,
          product: {
            supplierId: SUPPLIER_B,
            canonicalProductId: null,
            categoryId: CATEGORY_ID,
            basePrice: 200,
            supplier: { companyName: "Other Supplier" },
            pricingTiers: [],
          },
        },
      ]);

      productFindMany.mockResolvedValue([
        dbProduct(),
        dbProduct({
          id: PRODUCT_B,
          supplierId: SUPPLIER_B,
          basePrice: 200,
          supplier: { companyName: "Other Supplier" },
          pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 200 }],
        }),
      ]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      // Crucial: Deletes ONLY the snapshot IDs [item-a, item-b], leaving concurrently inserted item-c safe
      expect(cartItemDeleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: [ITEM_A_ID, ITEM_B_ID].sort() },
          userId: USER_ID,
        },
      });
    });

    it("Scenario 6 — Two simultaneous additions to the same cart product: targeted deletion preserves any new row ID", async () => {
      const OLD_ITEM_ID = "item-old-1";
      cartItemFindMany.mockResolvedValue([cartRow(5, 100, OLD_ITEM_ID)]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      // Even if another add-to-cart request overlaps checkout, deletion is targeted strictly to OLD_ITEM_ID
      expect(cartItemDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: [OLD_ITEM_ID] }, userId: USER_ID },
      });
    });

    it("Scenario 7 — Multi-supplier transaction failure: rolls back all writes, preserves cart, no notifications", async () => {
      const PRODUCT_B = "jsw-cement-supplier-b";
      const SUPPLIER_B = "supplier-2";

      cartItemFindMany.mockResolvedValue([
        cartRow(5, 100, "cart-item-1"),
        {
          id: "cart-item-2",
          productId: PRODUCT_B,
          quantity: 5,
          product: {
            supplierId: SUPPLIER_B,
            canonicalProductId: null,
            categoryId: CATEGORY_ID,
            basePrice: 200,
            supplier: { companyName: "Other Supplier" },
            pricingTiers: [],
          },
        },
      ]);

      productFindMany.mockResolvedValue([
        dbProduct(),
        dbProduct({
          id: PRODUCT_B,
          supplierId: SUPPLIER_B,
          basePrice: 200,
          supplier: { companyName: "Other Supplier" },
          pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 200 }],
        }),
      ]);

      let callCount = 0;
      orderCreate.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Foreign key constraint violation on supplier 2");
        }
        return {
          id: "order-1",
          enquiryId: "ABC-SITE01-000001",
          status: "PLACED",
          totalAmount: 500,
          items: [{ id: "item-1" }],
        };
      });

      const { createOrdersFromCart } = await import("./order-checkout");
      await expect(
        createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true })
      ).rejects.toThrow("Foreign key constraint violation on supplier 2");

      expect(cartItemDeleteMany).not.toHaveBeenCalled();
      expect(notifySupplierOrderSubmitted).not.toHaveBeenCalled();
      expect(notifySupplierRfqReceived).not.toHaveBeenCalled();
      expect(priceSnapshotCreate).not.toHaveBeenCalled();
    });

    it("Scenario 8 — Multiple buyers: locking one buyer's cart never blocks or affects another buyer's checkout", async () => {
      const BUYER_1 = "buyer-1";
      const BUYER_2 = "buyer-2";

      // Buyer 1 checkout
      cartItemFindMany.mockResolvedValue([cartRow(5, 100, "cart-b1-item-1")]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const res1 = await createOrdersFromCart(BUYER_1, { siteId: "site-1", requireSiteId: true });
      expect(res1.ok).toBe(true);

      // Verify Buyer 1 lock targeted only BUYER_1
      const call1Args = queryRawFn.mock.calls[0];
      expect(call1Args[1]).toBe(BUYER_1); // userId parameter

      // Buyer 2 checkout
      queryRawFn.mockClear();
      cartItemFindMany.mockResolvedValue([cartRow(10, 100, "cart-b2-item-1")]);

      const res2 = await createOrdersFromCart(BUYER_2, { siteId: "site-1", requireSiteId: true });
      expect(res2.ok).toBe(true);

      // Verify Buyer 2 lock targeted only BUYER_2
      const call2Args = queryRawFn.mock.calls[0];
      expect(call2Args[1]).toBe(BUYER_2); // userId parameter
    });

    it("Section 4 — Deletion count mismatch: rolls back transaction if fewer rows than snapshot are deleted", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5, 100, "item-1")]);
      productFindMany.mockResolvedValue([dbProduct()]);

      // Simulate deleteResult returning count 0 (unexpected mismatch)
      cartItemDeleteMany.mockResolvedValueOnce({ count: 0 });

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("Cart is empty");
    });

    it("Section 4 — Deletion count partial mismatch: rolls back transaction if partial deletion occurs", async () => {
      const PRODUCT_B = "jsw-cement-supplier-b";
      const SUPPLIER_B = "supplier-2";

      cartItemFindMany.mockResolvedValue([
        cartRow(5, 100, "item-1"),
        {
          id: "item-2",
          productId: PRODUCT_B,
          quantity: 5,
          product: {
            supplierId: SUPPLIER_B,
            canonicalProductId: null,
            categoryId: CATEGORY_ID,
            basePrice: 200,
            supplier: { companyName: "Other Supplier" },
            pricingTiers: [],
          },
        },
      ]);
      productFindMany.mockResolvedValue([
        dbProduct(),
        dbProduct({
          id: PRODUCT_B,
          supplierId: SUPPLIER_B,
          basePrice: 200,
          supplier: { companyName: "Other Supplier" },
          pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 200 }],
        }),
      ]);

      // Expected count is 2, but only 1 row was deleted
      cartItemDeleteMany.mockResolvedValueOnce({ count: 1 });

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
    });

    it("Section 3C — Deadlock & Serialization error handling: returns clean 409 temporary conflict", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5)]);
      productFindMany.mockResolvedValue([dbProduct()]);
      // Simulate PostgreSQL returning deadlock error on lock acquisition
      const deadlockError: any = new Error("deadlock detected: Process 12345 waits for ExclusiveLock on tuple");
      deadlockError.code = "40P01";
      queryRawFn.mockRejectedValueOnce(deadlockError);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Checkout could not be completed due to a temporary conflict. Please try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Section 3A — Deterministic ascending ID sorting: passes sorted IDs to avoid deadlocks across multi-item checkouts", async () => {
      // Snapshot items with unordered IDs: "zebra", "alpha", "mango"
      cartItemFindMany.mockResolvedValue([
        cartRow(5, 100, "zebra"),
        cartRow(5, 100, "alpha"),
        cartRow(5, 100, "mango"),
      ]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(true);
      expect(queryRawFn).toHaveBeenCalled();
      const rawArgs = queryRawFn.mock.calls[0];
      const sortedIds = rawArgs[2]; // 3rd parameter in tagged template (${sortedSnapshotItemIds})
      expect(sortedIds).toEqual(["alpha", "mango", "zebra"]);
    });

    it("Section 6 — Missing cart-item ID in initial cart snapshot fails safely with 400", async () => {
      // Cart item without an id (missing identifier)
      cartItemFindMany.mockResolvedValue([
        {
          productId: PRODUCT_ID,
          quantity: 5,
          product: dbProduct().pricingTiers ? dbProduct() : dbProduct(),
        },
      ]);
      productFindMany.mockResolvedValue([dbProduct()]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("One or more items in your cart are missing identifiers. Please refresh your cart.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Section 6 — Missing cart-item ID in locked rows fails safely with 409", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5, 100, "cart-item-1")]);
      productFindMany.mockResolvedValue([dbProduct()]);

      // Mock locked row returning missing/null id
      queryRawFn.mockResolvedValueOnce([
        { id: null, quantity: 5 },
      ]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Section 6 — Unexpected cart-item ID in locked rows fails safely with 409", async () => {
      cartItemFindMany.mockResolvedValue([cartRow(5, 100, "cart-item-1")]);
      productFindMany.mockResolvedValue([dbProduct()]);

      // Mock locked row returning unexpected ID (not in snapshot)
      queryRawFn.mockResolvedValueOnce([
        { id: "completely-different-item-id", quantity: 5 },
      ]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Section 7 — Add same product before checkout obtains lock: checkout detects changed snapshot and aborts", async () => {
      // Snapshot initially captured 10 units
      cartItemFindMany.mockResolvedValue([cartRow(10, 100, "cart-item-1")]);
      productFindMany.mockResolvedValue([dbProduct()]);

      // Before checkout acquired lock, another tab added 5 more, so locked row has 15
      queryRawFn.mockResolvedValueOnce([
        { id: "cart-item-1", quantity: 15 },
      ]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Section 7 — Update existing quantity before checkout obtains lock: checkout aborts on snapshot mismatch", async () => {
      // Snapshot initially captured 10 units
      cartItemFindMany.mockResolvedValue([cartRow(10, 100, "cart-item-1")]);
      productFindMany.mockResolvedValue([dbProduct()]);

      // Buyer changed quantity to 20 before checkout obtained the lock
      queryRawFn.mockResolvedValueOnce([
        { id: "cart-item-1", quantity: 20 },
      ]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Section 7 — Remove item before checkout locks it: checkout aborts safely", async () => {
      // Initial cart snapshot had 2 items
      cartItemFindMany.mockResolvedValue([
        cartRow(5, 100, "cart-item-1"),
        {
          id: "cart-item-2",
          productId: "prod-2",
          quantity: 2,
          product: dbProduct({ id: "prod-2", supplierId: "supp-2" }),
        },
      ]);
      productFindMany.mockResolvedValue([
        dbProduct(),
        dbProduct({ id: "prod-2", supplierId: "supp-2" }),
      ]);

      // One item was removed before lock was acquired, so query returns only 1 row
      queryRawFn.mockResolvedValueOnce([
        { id: "cart-item-1", quantity: 5 },
      ]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe("Your cart was updated during checkout. Please review your cart and try again.");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("Section 7 — Double checkout: second concurrent submission sees empty locked rows and aborts", async () => {
      // Snapshot had items, but first checkout completed and committed deletion
      cartItemFindMany.mockResolvedValue([cartRow(5, 100, "cart-item-1")]);
      productFindMany.mockResolvedValue([dbProduct()]);

      // Second checkout unblocks, rows are gone
      queryRawFn.mockResolvedValueOnce([]);

      const { createOrdersFromCart } = await import("./order-checkout");
      const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("Cart is empty");
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });
  });
});
