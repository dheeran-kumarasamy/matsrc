import { beforeEach, describe, expect, it, vi } from "vitest";

const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const productFindMany = vi.fn();
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
    product: { findMany: (...args: unknown[]) => productFindMany(...args) },
    order: { create: (...args: unknown[]) => orderCreate(...args) },
    priceSnapshot: { create: (...args: unknown[]) => priceSnapshotCreate(...args) },
    markupSetting: { findMany: (...args: unknown[]) => markupSettingFindMany(...args) },
    $transaction: async (callback: any) => {
      const tx = {
        order: { create: orderCreate },
        cartItem: {
          findMany: (...args: unknown[]) => cartItemFindMany(...args),
          deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
        },
      };
      return callback(tx);
    },
  },
  resolveUnitPrice: () => -1,
}));

const notifySupplierOrderSubmitted = vi.fn();
vi.mock("@/lib/notify", () => ({
  notifySupplierOrderSubmitted: (...args: unknown[]) => notifySupplierOrderSubmitted(...args),
}));

const notifySupplierRfqReceived = vi.fn();
let sequenceCounter = 0;
vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    generateEnquiryId: vi.fn(async () => {
      sequenceCounter++;
      return `EQ/2604/${String(sequenceCounter).padStart(5, "0")}`;
    }),
    notifySupplierRfqReceived: (...args: unknown[]) => notifySupplierRfqReceived(...args),
  };
});

import { createOrdersFromCart } from "./order-checkout";

describe("Order Checkout Optimization — Phase 2 (Targeted DB Queries & Batch Markup)", () => {
  const USER_ID = "builder-1";

  const PRODUCT_STEEL_A = {
    id: "steel-a",
    name: "Tata Tiscon 12mm TMT",
    supplierId: "supplier-tata",
    categoryId: "cat-steel",
    canonicalProductId: "canon-steel-12mm",
    basePrice: 65,
    stock: 2000,
    maxServiceableQty: 2000,
    isActive: true,
    supplier: { companyName: "Tata Dealer Corp" },
    pricingTiers: [
      { minQty: 1, maxQty: 99, tierPrice: 65 },
      { minQty: 100, maxQty: 2000, tierPrice: 60 },
    ],
  };

  const PRODUCT_STEEL_B = {
    id: "steel-b",
    name: "JSW Neosteel 12mm TMT",
    supplierId: "supplier-jsw",
    categoryId: "cat-steel",
    canonicalProductId: "canon-steel-12mm",
    basePrice: 64,
    stock: 3000,
    maxServiceableQty: 3000,
    isActive: true,
    supplier: { companyName: "JSW Direct Hub" },
    pricingTiers: [
      { minQty: 1, maxQty: 99, tierPrice: 64 },
      { minQty: 100, maxQty: 3000, tierPrice: 58 }, // Cheaper at quantity >= 100
    ],
  };

  const PRODUCT_CEMENT = {
    id: "cement-c",
    name: "UltraTech Super Cement",
    supplierId: "supplier-cement",
    categoryId: "cat-cement",
    canonicalProductId: null, // Single-supplier standalone product
    basePrice: 380,
    stock: 500,
    maxServiceableQty: 500,
    isActive: true,
    supplier: { companyName: "UltraTech Depot" },
    pricingTiers: [
      { minQty: 1, maxQty: 500, tierPrice: 380 },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sequenceCounter = 0;
    siteFindFirst.mockResolvedValue({ id: "site-1" });
    userFindUnique.mockResolvedValue({ name: "Ramesh Builder", email: "ramesh@build.in" });
    cartItemDeleteMany.mockImplementation(async (args: any) => {
      const ids = args?.where?.id?.in;
      return { count: Array.isArray(ids) ? ids.length : 1 };
    });
    priceSnapshotCreate.mockResolvedValue({});
    notifySupplierOrderSubmitted.mockResolvedValue(undefined);
    notifySupplierRfqReceived.mockResolvedValue(undefined);

    orderCreate.mockImplementation(async ({ data }: any) => ({
      id: `order-${Math.random().toString(36).substring(7)}`,
      enquiryId: data.enquiryId,
      status: data.status,
      totalAmount: data.totalAmount,
      items: data.items.create.map((item: any, i: number) => ({
        id: `item-${i}`,
        productId: item.productId,
        unitPrice: item.unitPrice,
      })),
    }));
  });

  it("replaces full-catalogue fetch with targeted Prisma query for products in the cart", async () => {
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-steel-1",
        productId: "steel-a",
        quantity: 150,
        product: {
          supplierId: "supplier-tata",
          canonicalProductId: "canon-steel-12mm",
          categoryId: "cat-steel",
          basePrice: 65,
          supplier: { companyName: "Tata Dealer Corp" },
          pricingTiers: PRODUCT_STEEL_A.pricingTiers,
        },
      },
      {
        id: "cart-cement-1",
        productId: "cement-c",
        quantity: 20,
        product: {
          supplierId: "supplier-cement",
          canonicalProductId: null,
          categoryId: "cat-cement",
          basePrice: 380,
          supplier: { companyName: "UltraTech Depot" },
          pricingTiers: PRODUCT_CEMENT.pricingTiers,
        },
      },
    ]);

    productFindMany.mockResolvedValue([
      PRODUCT_STEEL_A,
      PRODUCT_STEEL_B, // Sibling in the same canonical group
      PRODUCT_CEMENT,
    ]);

    markupSettingFindMany.mockResolvedValue([
      { scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true },
    ]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify targeted Prisma query was called with only relevant product IDs and canonicalProductIds
    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { id: { in: ["steel-a", "cement-c"] } },
          { canonicalProductId: { in: ["canon-steel-12mm"] } },
        ],
      },
      include: expect.any(Object),
      orderBy: { updatedAt: "desc" },
    });

    // 1 single batched markup query for both cart items
    expect(markupSettingFindMany).toHaveBeenCalledTimes(1);
    expect(markupSettingFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { scope: "PRODUCT", scopeId: { in: ["steel-a", "cement-c"] } },
          { scope: "CATEGORY", scopeId: { in: ["cat-steel", "cat-cement"] } },
          { scope: "GLOBAL", scopeId: null },
        ],
      },
    });

    // Steel: at quantity 150, JSW (supplier-jsw) is lowest price: tier 58. With 10% markup: 58 * 1.1 = 63.8
    // Cement: UltraTech (supplier-cement) is 380. With 10% markup: 380 * 1.1 = 418
    // Since steel routed to supplier-jsw and cement routed to supplier-cement, 2 separate supplier orders were created!
    expect(result.orders).toHaveLength(2);

    const steelOrder = result.orders.find((o) => o.supplierName.includes("JSW") || o.total === 150 * 63.8);
    expect(steelOrder).toBeDefined();
    expect(steelOrder?.total).toBe(150 * 63.8);

    const cementOrder = result.orders.find((o) => o.total === 20 * 418);
    expect(cementOrder).toBeDefined();
    expect(cementOrder?.total).toBe(20 * 418);

    // Cart cleanup is called after order creation targeting snapshot items
    expect(cartItemDeleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["cart-cement-1", "cart-steel-1"] },
        userId: USER_ID,
      },
    });
  });

  it("multi-supplier candidate ranking and pool preservation for fan-out", async () => {
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-steel-1",
        productId: "steel-a",
        quantity: 150,
        product: {
          supplierId: "supplier-tata",
          canonicalProductId: "canon-steel-12mm",
          categoryId: "cat-steel",
          basePrice: 65,
          supplier: { companyName: "Tata Dealer Corp" },
          pricingTiers: PRODUCT_STEEL_A.pricingTiers,
        },
      },
    ]);

    productFindMany.mockResolvedValue([PRODUCT_STEEL_A, PRODUCT_STEEL_B]);
    markupSettingFindMany.mockResolvedValue([]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });
    expect(result.ok).toBe(true);

    const createdData = orderCreate.mock.calls[0][0].data;
    const itemData = createdData.items.create[0];

    // Winner at 150 units is JSW (58/unit)
    expect(itemData.supplierId).toBe("supplier-jsw");
    expect(itemData.unitPrice).toBe(58);

    // Full candidate pool preserved in order of rank
    expect(itemData.candidates.create).toHaveLength(2);
    expect(itemData.candidates.create[0].supplierId).toBe("supplier-jsw");
    expect(itemData.candidates.create[0].rank).toBe(0);
    expect(itemData.candidates.create[0].unitPrice).toBe(58);

    expect(itemData.candidates.create[1].supplierId).toBe("supplier-tata");
    expect(itemData.candidates.create[1].rank).toBe(1);
    expect(itemData.candidates.create[1].unitPrice).toBe(60);
  });

  it("excludes inactive products from candidates pool", async () => {
    const INACTIVE_STEEL = { ...PRODUCT_STEEL_B, id: "steel-inactive", isActive: false };
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-steel-1",
        productId: "steel-a",
        quantity: 150,
        product: {
          supplierId: "supplier-tata",
          canonicalProductId: "canon-steel-12mm",
          categoryId: "cat-steel",
          basePrice: 65,
          supplier: { companyName: "Tata Dealer Corp" },
          pricingTiers: PRODUCT_STEEL_A.pricingTiers,
        },
      },
    ]);

    // Prisma query filters out inactive listings (where: { isActive: true })
    productFindMany.mockResolvedValue([PRODUCT_STEEL_A]); // INACTIVE_STEEL not returned
    markupSettingFindMany.mockResolvedValue([]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });
    expect(result.ok).toBe(true);

    const createdData = orderCreate.mock.calls[0][0].data;
    const itemData = createdData.items.create[0];
    expect(itemData.supplierId).toBe("supplier-tata");
    expect(itemData.candidates.create).toHaveLength(1);
  });

  it("preserves atomic enquiry sequence generation and monotonicity", async () => {
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-cement-1",
        productId: "cement-c",
        quantity: 10,
        product: {
          supplierId: "supplier-cement",
          canonicalProductId: null,
          categoryId: "cat-cement",
          basePrice: 380,
          supplier: { companyName: "UltraTech Depot" },
          pricingTiers: PRODUCT_CEMENT.pricingTiers,
        },
      },
    ]);

    productFindMany.mockResolvedValue([PRODUCT_CEMENT]);
    markupSettingFindMany.mockResolvedValue([]);

    const result1 = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });
    const result2 = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;

    expect(result1.orders[0].enquiryId).toBe("EQ/2604/00001");
    expect(result2.orders[0].enquiryId).toBe("EQ/2604/00002");
    expect(result1.orders[0].enquiryId).not.toBe(result2.orders[0].enquiryId);
  });

  it("rolls back completely and does not clear cart if transaction throws", async () => {
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-cement-1",
        productId: "cement-c",
        quantity: 10,
        product: {
          supplierId: "supplier-cement",
          canonicalProductId: null,
          categoryId: "cat-cement",
          basePrice: 380,
          supplier: { companyName: "UltraTech Depot" },
          pricingTiers: PRODUCT_CEMENT.pricingTiers,
        },
      },
    ]);

    productFindMany.mockResolvedValue([PRODUCT_CEMENT]);
    orderCreate.mockRejectedValue(new Error("Database transaction aborted (P2028)"));

    await expect(
      createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true })
    ).rejects.toThrow("Database transaction aborted (P2028)");

    // Cart is NOT deleted when creation fails (cart deletion occurs only after order creation succeeds)
    expect(cartItemDeleteMany).not.toHaveBeenCalled();
    expect(orderCreate).toHaveBeenCalled();
  });
});

