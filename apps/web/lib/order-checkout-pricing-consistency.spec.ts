// S04/S09 regression — base-price/tier-pricing consistency through
// Supplier -> Product -> Cart -> Checkout -> Order.
//
// Proves createOrdersFromCart() (the authoritative server-side checkout/
// order-creation pricing calculation) correctly resolves the supplier's
// real basePrice/PricingTier configuration now that the public listings API
// (apps/supplier/lib/supplier-data.ts's getPublicSupplierListings) exposes
// `basePriceRaw`/`pricingTiersRaw` under the field names this module already
// expects (see apps/supplier/lib/get-public-supplier-listings-raw-pricing-fields.spec.ts
// for the upstream half of this same fix). Before the fix, these fields were
// always undefined here, so every order line silently fell back to treating
// the listing as having no tiers — this test would have produced the WRONG
// unit price (ignoring the tier) prior to the fix.
//
// Mocking pattern mirrors lib/order-checkout-independence.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const orderCreate = vi.fn();
const priceSnapshotCreate = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    cartItem: {
      findMany: (...args: unknown[]) => cartItemFindMany(...args),
      deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
    },
    site: { findFirst: (...args: unknown[]) => siteFindFirst(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    order: { create: (...args: unknown[]) => orderCreate(...args) },
    priceSnapshot: { create: (...args: unknown[]) => priceSnapshotCreate(...args) },
    $transaction: (callback: any) => callback({ order: { create: orderCreate } }),
  },
  // Legacy fallback resolver — only exercised when no live public listing
  // resolves (see order-checkout.ts). Deliberately returns a value DIFFERENT
  // from every tier price below, so any test that accidentally hits this
  // fallback path fails loudly instead of silently appearing correct.
  resolveUnitPrice: () => -1,
}));

// Captured so beforeEach can re-arm its resolved value every test — the
// shared vitest.config.ts sets `restoreMocks: true`, which wipes an inline
// vi.fn()'s mockResolvedValue() back to "no implementation" between tests.
const notifySupplierOrderSubmitted = vi.fn();
vi.mock("@/lib/notify", () => ({
  notifySupplierOrderSubmitted: (...args: unknown[]) => notifySupplierOrderSubmitted(...args),
}));

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    generateEnquiryId: vi.fn().mockResolvedValue("ABC-SITE01-000001"),
  };
});

const USER_ID = "builder-1";
const PRODUCT_ID = "jsw-cement";
const SUPPLIER_ID = "supplier-1";

function publicListing(overrides: Record<string, unknown> = {}) {
  // Shape mirrors the REAL fixed getPublicSupplierListings() response —
  // including the basePriceRaw/pricingTiersRaw fields this fix adds.
  return {
    id: PRODUCT_ID,
    supplierId: SUPPLIER_ID,
    canonicalProductId: null,
    headlineSupplierId: SUPPLIER_ID,
    groupedListingIds: [PRODUCT_ID],
    price: "₹100 / BAG",
    stock: "1000 BAG",
    maxServiceableQty: "1000 BAG",
    active: true,
    basePriceRaw: 100,
    stockRaw: 1000,
    maxServiceableQtyRaw: 1000,
    pricingTiersRaw: [
      { minQty: 1, maxQty: 9, tierPrice: 100 },
      { minQty: 10, maxQty: 1000, tierPrice: 90 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  cartItemFindMany.mockReset();
  cartItemDeleteMany.mockReset();
  siteFindFirst.mockReset();
  userFindUnique.mockReset();
  orderCreate.mockReset();
  priceSnapshotCreate.mockReset();
  priceSnapshotCreate.mockResolvedValue({});
  notifySupplierOrderSubmitted.mockReset();
  notifySupplierOrderSubmitted.mockResolvedValue(undefined);
  cartItemDeleteMany.mockResolvedValue({ count: 1 });

  siteFindFirst.mockResolvedValue({ id: "site-1" });
  userFindUnique.mockResolvedValue({ name: "Builder", email: "builder@example.com" });

  orderCreate.mockImplementation(async ({ data }: any) => ({
    id: "order-1",
    enquiryId: "ABC-SITE01-000001",
    status: data.status,
    totalAmount: data.totalAmount,
    items: data.items.create.map((_: unknown, i: number) => ({ id: `item-${i}` })),
  }));
});

function cartRow(quantity: number, basePrice = 100) {
  return {
    productId: PRODUCT_ID,
    quantity,
    product: {
      supplierId: SUPPLIER_ID,
      canonicalProductId: null,
      basePrice,
      supplier: { companyName: "JSW Supplier" },
      pricingTiers: [
        { minQty: 1, maxQty: 9, tierPrice: 100 },
        { minQty: 10, maxQty: 1000, tierPrice: 90 },
      ],
    },
  };
}

describe("createOrdersFromCart — S04/S09 base-price/tier-pricing consistency", () => {
  it("Test 1 — base price: quantity below the first tier threshold uses the supplier's base price (₹100), unchanged", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(5)]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => [publicListing()],
      })
    );

    const { createOrdersFromCart } = await import("./order-checkout");
    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // quantity=5 is within tier 1 (1-9 @ ₹100) — base price applies, not a fabricated/stale value.
    expect(result.orders[0].total).toBe(500);
  });

  it("Test 2 — existing tier applies: quantity at the tier-2 threshold uses the configured tier price (₹90), never the base price", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(10)]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => [publicListing()],
      })
    );

    const { createOrdersFromCart } = await import("./order-checkout");
    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // quantity=10 enters tier 2 (10-1000 @ ₹90) — the existing tier rule must be honoured, not overridden by base price.
    expect(result.orders[0].total).toBe(900);
  });

  it("Test 3 — supplier price update: a changed base price (₹100 -> ₹120) is reflected for quantities with no applicable tier", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(5, 120)]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => [
          publicListing({
            price: "₹120 / BAG",
            basePriceRaw: 120,
            pricingTiersRaw: [
              { minQty: 1, maxQty: 9, tierPrice: 120 },
              { minQty: 10, maxQty: 1000, tierPrice: 90 },
            ],
          }),
        ],
      })
    );

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
      cartRow(5, 100),
      {
        productId: PRODUCT_B,
        quantity: 5,
        product: {
          supplierId: SUPPLIER_B,
          canonicalProductId: null,
          basePrice: 200,
          supplier: { companyName: "Other Supplier" },
          pricingTiers: [],
        },
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => [
          publicListing(),
          publicListing({
            id: PRODUCT_B,
            supplierId: SUPPLIER_B,
            headlineSupplierId: SUPPLIER_B,
            groupedListingIds: [PRODUCT_B],
            price: "₹200 / BAG",
            basePriceRaw: 200,
            pricingTiersRaw: [{ minQty: 1, maxQty: 1000, tierPrice: 200 }],
          }),
        ],
      })
    );

    const { createOrdersFromCart } = await import("./order-checkout");
    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two distinct suppliers -> two distinct grouped orders, each with its own isolated price.
    expect(result.orders).toHaveLength(2);
    const totals = result.orders.map((o) => o.total).sort((a, b) => a - b);
    expect(totals).toEqual([500, 1000]); // 5*100 and 5*200 — never 5*100 and 5*100, or cross-contaminated.
  });
});
