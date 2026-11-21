import { beforeEach, describe, expect, it, vi } from "vitest";

const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const productFindMany = vi.fn();
const orderCreate = vi.fn();
const priceSnapshotCreate = vi.fn();
const markupSettingFindMany = vi.fn();
const orderSplittingConfigFindUnique = vi.fn();

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
    orderSplittingConfig: {
      findUnique: (...args: unknown[]) => orderSplittingConfigFindUnique(...args),
    },
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

vi.mock("@/lib/notify", () => ({
  notifySupplierOrderSubmitted: vi.fn(),
}));

let sequenceCounter = 0;
vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    generateEnquiryId: vi.fn(async () => {
      sequenceCounter++;
      return `EQ/2604/${String(sequenceCounter).padStart(5, "0")}`;
    }),
    notifySupplierRfqReceived: vi.fn(),
  };
});

import { createOrdersFromCart } from "./order-checkout";

describe("Order Splitting Restrictions & Single-Supplier Basket Optimization", () => {
  const USER_ID = "builder-test";

  // Products:
  // Item 1: 12mm TMT Steel
  // Tata: 12mm @ 60 (tier >= 100), base 65
  // JSW: 12mm @ 58 (tier >= 100), base 64
  //
  // Item 2: 16mm TMT Steel
  // Tata: 16mm @ 65 (base)
  // JSW: 16mm @ 75 (base)
  //
  // Basket comparison:
  // For 100 units of 12mm and 50 units of 16mm:
  // Tata: (100 * 60) + (50 * 65) = 6000 + 3250 = 9250
  // JSW:  (100 * 58) + (50 * 75) = 5800 + 3750 = 9550
  // Tata has lowest total basket price (9250 < 9550), even though JSW is cheaper on 12mm alone!

  const TATA_STEEL_12 = {
    id: "tata-12",
    name: "Tata Tiscon 12mm TMT",
    supplierId: "supplier-tata",
    categoryId: "cat-steel",
    canonicalProductId: "canon-12",
    basePrice: 65,
    stock: 1000,
    maxServiceableQty: 1000,
    isActive: true,
    isOrderable: true,
    category: { id: "cat-steel", name: "Steel", isOrderable: true },
    supplier: { companyName: "Tata Dealer Corp" },
    pricingTiers: [{ minQty: 100, maxQty: 1000, tierPrice: 60 }],
  };

  const JSW_STEEL_12 = {
    id: "jsw-12",
    name: "JSW Neosteel 12mm TMT",
    supplierId: "supplier-jsw",
    categoryId: "cat-steel",
    canonicalProductId: "canon-12",
    basePrice: 64,
    stock: 1000,
    maxServiceableQty: 1000,
    isActive: true,
    isOrderable: true,
    category: { id: "cat-steel", name: "Steel", isOrderable: true },
    supplier: { companyName: "JSW Direct Hub" },
    pricingTiers: [{ minQty: 100, maxQty: 1000, tierPrice: 58 }],
  };

  const TATA_STEEL_16 = {
    id: "tata-16",
    name: "Tata Tiscon 16mm TMT",
    supplierId: "supplier-tata",
    categoryId: "cat-steel",
    canonicalProductId: "canon-16",
    basePrice: 65,
    stock: 1000,
    maxServiceableQty: 1000,
    isActive: true,
    isOrderable: true,
    category: { id: "cat-steel", name: "Steel", isOrderable: true },
    supplier: { companyName: "Tata Dealer Corp" },
    pricingTiers: [],
  };

  const JSW_STEEL_16 = {
    id: "jsw-16",
    name: "JSW Neosteel 16mm TMT",
    supplierId: "supplier-jsw",
    categoryId: "cat-steel",
    canonicalProductId: "canon-16",
    basePrice: 75,
    stock: 1000,
    maxServiceableQty: 1000,
    isActive: true,
    isOrderable: true,
    category: { id: "cat-steel", name: "Steel", isOrderable: true },
    supplier: { companyName: "JSW Direct Hub" },
    pricingTiers: [],
  };

  const ULTRATECH_CEMENT = {
    id: "cement-1",
    name: "UltraTech Cement 50kg",
    supplierId: "supplier-cement",
    categoryId: "cat-cement",
    canonicalProductId: "canon-cement",
    basePrice: 380,
    stock: 500,
    maxServiceableQty: 500,
    isActive: true,
    isOrderable: true,
    category: { id: "cat-cement", name: "Cement", isOrderable: true },
    supplier: { companyName: "UltraTech Depot" },
    pricingTiers: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sequenceCounter = 0;
    siteFindFirst.mockResolvedValue({ id: "site-1" });
    userFindUnique.mockResolvedValue({ name: "Buyer 1", email: "buyer1@test.com" });
    cartItemDeleteMany.mockResolvedValue({ count: 2 });
    priceSnapshotCreate.mockResolvedValue({});
    markupSettingFindMany.mockResolvedValue([]);

    orderCreate.mockImplementation(async ({ data }: any) => ({
      id: `order-${Math.random().toString(36).substring(7)}`,
      enquiryId: data.enquiryId,
      status: data.status,
      totalAmount: data.totalAmount,
      supplierName: data.supplierId,
      items: data.items.create.map((item: any, i: number) => ({
        id: `item-${i}`,
        productId: item.productId,
        unitPrice: item.unitPrice,
        supplierId: item.supplierId,
      })),
    }));
  });

  it("selects the single supplier with lowest total basket price when order splitting is disabled", async () => {
    // Admin config: splitting disabled
    orderSplittingConfigFindUnique.mockResolvedValue({
      id: "global",
      allowMultiSupplierSplitting: false,
      splitOnlyAcrossCategories: true,
    });

    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-item-1",
        productId: "tata-12",
        quantity: 100,
        product: TATA_STEEL_12,
      },
      {
        id: "cart-item-2",
        productId: "tata-16",
        quantity: 50,
        product: TATA_STEEL_16,
      },
    ]);

    productFindMany.mockResolvedValue([
      TATA_STEEL_12,
      JSW_STEEL_12,
      TATA_STEEL_16,
      JSW_STEEL_16,
    ]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both items must be assigned to Tata because Tata's basket is ₹9,250 vs JSW's ₹9,550
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].itemCount).toBe(2);
    expect(result.orders[0].total).toBe(9250);

    // Verify order items were created for supplier-tata
    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 9250,
          items: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ supplierId: "supplier-tata", productId: "tata-12" }),
              expect.objectContaining({ supplierId: "supplier-tata", productId: "tata-16" }),
            ]),
          }),
        }),
      })
    );
  });

  it("refuses checkout (Option A) and identifies missing items when no single supplier can fulfill all items", async () => {
    // Splitting disabled
    orderSplittingConfigFindUnique.mockResolvedValue({
      id: "global",
      allowMultiSupplierSplitting: false,
      splitOnlyAcrossCategories: true,
    });

    // Cart has Steel and Cement, but Tata only supplies Steel and UltraTech only supplies Cement
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-item-1",
        productId: "tata-12",
        quantity: 100,
        product: TATA_STEEL_12,
      },
      {
        id: "cart-item-2",
        productId: "cement-1",
        quantity: 50,
        product: ULTRATECH_CEMENT,
      },
    ]);

    productFindMany.mockResolvedValue([
      TATA_STEEL_12,
      ULTRATECH_CEMENT,
    ]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.status).toBe(400);
    expect(result.error).toContain("must be fulfilled by a single supplier");
    expect(result.error).toContain("Tata Tiscon 12mm TMT");
    expect(result.error).toContain("UltraTech Cement 50kg");
  });

  it("splits across categories when allowMultiSupplierSplitting: true and splitOnlyAcrossCategories: true", async () => {
    // Admin config: splitting enabled only across categories
    orderSplittingConfigFindUnique.mockResolvedValue({
      id: "global",
      allowMultiSupplierSplitting: true,
      splitOnlyAcrossCategories: true,
    });

    // Cart has Steel (JSW cheaper) and Cement (UltraTech)
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-item-1",
        productId: "tata-12",
        quantity: 100,
        product: TATA_STEEL_12,
      },
      {
        id: "cart-item-2",
        productId: "cement-1",
        quantity: 50,
        product: ULTRATECH_CEMENT,
      },
    ]);

    productFindMany.mockResolvedValue([
      TATA_STEEL_12,
      JSW_STEEL_12,
      ULTRATECH_CEMENT,
    ]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Must create 2 distinct orders: 1 for Steel (JSW) and 1 for Cement (UltraTech)
    expect(result.orders).toHaveLength(2);
    const jswOrder = result.orders.find((o) => o.total === 5800);
    const cementOrder = result.orders.find((o) => o.total === 19000);

    expect(jswOrder).toBeDefined();
    expect(jswOrder?.total).toBe(5800); // 100 * 58

    expect(cementOrder).toBeDefined();
    expect(cementOrder?.total).toBe(19000); // 50 * 380

    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 5800,
          items: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ supplierId: "supplier-jsw" }),
            ]),
          }),
        }),
      })
    );
    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 19000,
          items: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ supplierId: "supplier-cement" }),
            ]),
          }),
        }),
      })
    );
  });

  it("prevents splitting within the same category when splitOnlyAcrossCategories: true", async () => {
    orderSplittingConfigFindUnique.mockResolvedValue({
      id: "global",
      allowMultiSupplierSplitting: true,
      splitOnlyAcrossCategories: true,
    });

    // Both items are in category "cat-steel"
    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-item-1",
        productId: "tata-12",
        quantity: 100,
        product: TATA_STEEL_12,
      },
      {
        id: "cart-item-2",
        productId: "tata-16",
        quantity: 50,
        product: TATA_STEEL_16,
      },
    ]);

    productFindMany.mockResolvedValue([
      TATA_STEEL_12,
      JSW_STEEL_12,
      TATA_STEEL_16,
      JSW_STEEL_16,
    ]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both items are in Steel category: must NOT be split, must go to Tata (lowest basket)
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].total).toBe(9250);

    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 9250,
          items: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ supplierId: "supplier-tata", productId: "tata-12" }),
              expect.objectContaining({ supplierId: "supplier-tata", productId: "tata-16" }),
            ]),
          }),
        }),
      })
    );
  });

  it("refuses checkout when product is disabled for customer ordering (isOrderable: false)", async () => {
    const DISABLED_PRODUCT = {
      ...TATA_STEEL_12,
      isOrderable: false,
    };

    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-item-1",
        productId: "tata-12",
        quantity: 100,
        product: DISABLED_PRODUCT,
      },
    ]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.status).toBe(400);
    expect(result.error).toContain("currently not available for customer ordering");
    expect(result.error).toContain("Tata Tiscon 12mm TMT");
  });

  it("refuses checkout when category is disabled for customer ordering (category.isOrderable: false)", async () => {
    const DISABLED_CAT_PRODUCT = {
      ...TATA_STEEL_12,
      category: {
        id: "cat-steel",
        name: "Steel",
        isOrderable: false,
      },
    };

    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-item-1",
        productId: "tata-12",
        quantity: 100,
        product: DISABLED_CAT_PRODUCT,
      },
    ]);

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.status).toBe(400);
    expect(result.error).toContain("currently not available for customer ordering");
  });
});
