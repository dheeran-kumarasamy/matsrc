// Admin-Configurable Product Markup — regression coverage for
// createOrdersFromCart(), the initial buyer-facing price-setting call site
// (see packages/db/lib/markup-calculation.ts and OrderItem's schema doc
// comment for the full snapshot lifecycle this feature implements).
//
// Mocking pattern mirrors the existing
// order-checkout-pricing-consistency.spec.ts exactly.

import { beforeEach, describe, expect, it, vi } from "vitest";

const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const orderCreate = vi.fn();
const priceSnapshotCreate = vi.fn();
const markupSettingFindMany = vi.fn();

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
    markupSetting: { findMany: (...args: unknown[]) => markupSettingFindMany(...args) },
    $transaction: (callback: any) => callback({ order: { create: orderCreate } }),
  },
  resolveUnitPrice: () => -1,
}));

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
const CATEGORY_ID = "cat-cement";

function publicListing(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    supplierId: SUPPLIER_ID,
    canonicalProductId: null,
    headlineSupplierId: SUPPLIER_ID,
    groupedListingIds: [PRODUCT_ID],
    price: "₹1000 / BAG",
    stock: "1000 BAG",
    maxServiceableQty: "1000 BAG",
    active: true,
    basePriceRaw: 1000,
    stockRaw: 1000,
    maxServiceableQtyRaw: 1000,
    pricingTiersRaw: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }],
    ...overrides,
  };
}

function cartRow(quantity: number, basePrice = 1000) {
  return {
    productId: PRODUCT_ID,
    quantity,
    product: {
      supplierId: SUPPLIER_ID,
      canonicalProductId: null,
      categoryId: CATEGORY_ID,
      basePrice,
      supplier: { companyName: "JSW Supplier" },
      pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: basePrice }],
    },
  };
}

beforeEach(() => {
  cartItemFindMany.mockReset();
  cartItemDeleteMany.mockReset();
  siteFindFirst.mockReset();
  userFindUnique.mockReset();
  orderCreate.mockReset();
  priceSnapshotCreate.mockReset();
  markupSettingFindMany.mockReset();
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

describe("createOrdersFromCart — Admin-Configurable Product Markup", () => {
  it("applies the canonical 10% markup: buyer pays ₹1,100 per unit for a ₹1,000 supplier price", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(5)]);
    markupSettingFindMany.mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true }]);
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
    // Buyer line value = 5 * 1100 = 5500 (never 5 * 1000 = 5000, the raw supplier value).
    expect(result.orders[0].total).toBe(5500);

    const createdOrderCall = orderCreate.mock.calls[0][0];
    const line = createdOrderCall.data.items.create[0];
    expect(line.unitPrice).toBe(1100);
    expect(line.supplierUnitPrice).toBe(1000);
    expect(line.markupPercent).toBe(10);
    expect(line.markupAmount).toBe(100);
  });

  it("prefers a product-level override over the global default", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(1)]);
    markupSettingFindMany.mockResolvedValue([
      { scope: "PRODUCT", scopeId: PRODUCT_ID, percentage: 5, isEnabled: true },
      { scope: "GLOBAL", scopeId: null, percentage: 20, isEnabled: true },
    ]);
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
    expect(result.orders[0].total).toBe(1050); // 1000 * 1.05, not 1000 * 1.20
  });

  it("honours an explicit, enabled 0% override distinctly from no configuration", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(1)]);
    markupSettingFindMany.mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 0, isEnabled: true }]);
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
    expect(result.orders[0].total).toBe(1000);
    const line = orderCreate.mock.calls[0][0].data.items.create[0];
    expect(line.markupPercent).toBe(0);
  });

  it("fails safe to 0% (never blocks checkout) when no markup configuration exists at all", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(1)]);
    markupSettingFindMany.mockResolvedValue([]);
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
    expect(result.orders[0].total).toBe(1000);
  });

  it("never applies markup to the supplier-facing askPrice", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(5)]);
    markupSettingFindMany.mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true }]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => [publicListing()],
      })
    );

    const { createOrdersFromCart } = await import("./order-checkout");
    await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    const line = orderCreate.mock.calls[0][0].data.items.create[0];
    // askPrice is the supplier-side figure — must remain the ORIGINAL
    // supplier price (1000), never the marked-up buyer price (1100).
    expect(line.askPrice).toBe(1000);
  });

  // Finding 4: the "ORDER"-source PriceSnapshot writer previously stored
  // item.unitPrice (post-markup), silently inflating every downstream
  // price-discovery/market-intelligence report by the platform's own
  // margin. Fixed to use item.supplierUnitPrice instead, mirroring the
  // already-correct "RFQ_ACCEPTED"-source writer in
  // BestPriceSelectionService.
  it("records the PriceSnapshot (source: ORDER) using the ORIGINAL supplier price, never the marked-up buyer price", async () => {
    cartItemFindMany.mockResolvedValue([cartRow(5)]);
    markupSettingFindMany.mockResolvedValue([{ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true }]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => [publicListing()],
      })
    );

    const { createOrdersFromCart } = await import("./order-checkout");
    await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    // Fire-and-forget: wait a tick for the non-blocking priceSnapshot.create
    // call (scheduled via `void prisma.priceSnapshot.create(...)`) to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(priceSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: PRODUCT_ID, supplierId: SUPPLIER_ID, price: 1000, source: "ORDER" }),
      })
    );
  });
});
