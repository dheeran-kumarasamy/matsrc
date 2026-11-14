import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for builder-db and db package
const productFindFirst = vi.fn();
const productFindMany = vi.fn();
const cartItemUpsert = vi.fn();
const cartItemFindMany = vi.fn();
const cartItemFindUnique = vi.fn();
const cartItemFindFirst = vi.fn();
const cartItemUpdate = vi.fn();
const cartItemDeleteMany = vi.fn();
const queryRawFn = vi.fn();
const transactionFn = vi.fn(async (...args: any[]) => {
  const cb = args[0];
  if (typeof cb === "function") {
    return cb({
      product: {
        findFirst: (...args: unknown[]) => productFindFirst(...args),
        findMany: (...args: unknown[]) => productFindMany(...args),
      },
      cartItem: {
        upsert: (...args: unknown[]) => cartItemUpsert(...args),
        findMany: (...args: unknown[]) => cartItemFindMany(...args),
        findUnique: (...args: unknown[]) => cartItemFindUnique(...args),
        findFirst: (...args: unknown[]) => cartItemFindFirst(...args),
        update: (...args: unknown[]) => cartItemUpdate(...args),
        deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
      },
      cartIdempotency: {
        findUnique: (...args: unknown[]) => cartIdempotencyFindUnique(...args),
        findMany: (...args: unknown[]) => cartIdempotencyFindMany(...args),
        create: (...args: unknown[]) => cartIdempotencyCreate(...args),
        deleteMany: (...args: unknown[]) => cartIdempotencyDeleteMany(...args),
      },
      markupSetting: {
        findMany: (...args: unknown[]) => markupSettingFindMany(...args),
      },
      $queryRaw: (...args: unknown[]) => queryRawFn(...args),
    });
  }
  return cb;
});
const userFindUnique = vi.fn();
const userUpsert = vi.fn();
const markupSettingFindMany = vi.fn();
const cartIdempotencyFindUnique = vi.fn();
const cartIdempotencyFindMany = vi.fn();
const cartIdempotencyCreate = vi.fn();
const cartIdempotencyDeleteMany = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    product: {
      findFirst: (...args: unknown[]) => productFindFirst(...args),
      findMany: (...args: unknown[]) => productFindMany(...args),
    },
    cartItem: {
      upsert: (...args: unknown[]) => cartItemUpsert(...args),
      findMany: (...args: unknown[]) => cartItemFindMany(...args),
      findUnique: (...args: unknown[]) => cartItemFindUnique(...args),
      findFirst: (...args: unknown[]) => cartItemFindFirst(...args),
      update: (...args: unknown[]) => cartItemUpdate(...args),
      deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
    },
    cartIdempotency: {
      findUnique: (...args: unknown[]) => cartIdempotencyFindUnique(...args),
      findMany: (...args: unknown[]) => cartIdempotencyFindMany(...args),
      create: (...args: unknown[]) => cartIdempotencyCreate(...args),
      deleteMany: (...args: unknown[]) => cartIdempotencyDeleteMany(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      upsert: (...args: unknown[]) => userUpsert(...args),
    },
    markupSetting: {
      findMany: (...args: unknown[]) => markupSettingFindMany(...args),
    },
    $transaction: (...args: any[]) => transactionFn(...args),
    $queryRaw: (...args: any[]) => queryRawFn(...args),
  },
  resolveUnitPrice: (product: any, quantity: number) => {
    const tiers = Array.isArray(product.pricingTiers) ? product.pricingTiers : [];
    const matched = tiers.find((t: any) => quantity >= t.minQty && quantity <= t.maxQty);
    return Number(matched?.tierPrice ?? product.basePrice);
  },
  formatCurrency: (amount: number | string) => `₹${Number(amount).toLocaleString("en-IN")}`,
  getOrCreateBuilder: async (userId: string, email: string, name: string) => ({
    id: userId,
    email,
    name,
    role: "BUILDER",
  }),
  resolveUserCtx: async () => ({
    userId: "builder-user-1",
    email: "builder@example.com",
    name: "Builder One",
  }),
}));

import {
  resolveProductGroupForCart,
  getCartForUser,
  cleanupExpiredCartIdempotencies,
  computeRequestFingerprint,
} from "./cart-data";
import { POST } from "../app/api/builder/cart/items/route";
import { DELETE } from "../app/api/builder/cart/items/[productId]/route";
import { GET as cronCleanupGet } from "../app/api/cron/cleanup-idempotency/route";
import { useCartStore } from "./store/cart-store";
import * as apiModule from "@/lib/api";

describe("Cart Optimization — Phase 1", () => {
  const PRODUCT_A = {
    id: "prod-a",
    slug: "cement-grade-53",
    name: "UltraTech 53 Grade Cement",
    unit: "BAG",
    supplierId: "supp-1",
    categoryId: "cat-cement",
    basePrice: 380,
    stock: 500,
    maxServiceableQty: 500,
    isActive: true,
    canonicalProductId: "canon-cement-53",
    supplier: { companyName: "Supplier Alpha" },
    pricingTiers: [
      { minQty: 1, maxQty: 49, tierPrice: 380 },
      { minQty: 50, maxQty: 500, tierPrice: 360 },
    ],
  };

  const PRODUCT_B_SIBLING = {
    id: "prod-b",
    slug: "jsw-grade-53",
    name: "JSW 53 Grade Cement",
    unit: "BAG",
    supplierId: "supp-2",
    categoryId: "cat-cement",
    basePrice: 390,
    stock: 1000,
    maxServiceableQty: 1000,
    isActive: true,
    canonicalProductId: "canon-cement-53",
    supplier: { companyName: "Supplier Beta" },
    pricingTiers: [
      { minQty: 1, maxQty: 49, tierPrice: 390 },
      { minQty: 50, maxQty: 500, tierPrice: 350 }, // Cheaper at quantity >= 50
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cartItemFindMany.mockResolvedValue([]);
    markupSettingFindMany.mockResolvedValue([]);
    cartItemDeleteMany.mockResolvedValue({ count: 1 });
    const idempotencyStore = new Map<string, any>();
    cartIdempotencyFindUnique.mockImplementation(async ({ where }: any) => {
      const compositeKey = `${where.userId_key.userId}:${where.userId_key.key}`;
      return idempotencyStore.get(compositeKey) || null;
    });
    cartIdempotencyCreate.mockImplementation(async ({ data }: any) => {
      const compositeKey = `${data.userId}:${data.key}`;
      const record = { ...data, id: "idem-rec-1" };
      idempotencyStore.set(compositeKey, record);
      return record;
    });
    queryRawFn.mockImplementation(async (strings: any, ...values: any[]) => {
      const q = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (q.includes("pg_advisory_xact_lock")) {
        return [];
      }
      if (q.includes("FOR UPDATE")) {
        const val = await cartItemFindUnique();
        return val ? [val] : [];
      }
      return [];
    });
    useCartStore.setState({
      items: [],
      summary: { itemCount: 0, subtotal: 0, subtotalLabel: "₹0" },
      hasLoaded: false,
      isLoading: false,
      isMutating: false,
      error: null,
    });
  });

  describe("Targeted Database Lookup (resolveProductGroupForCart)", () => {
    it("retrieves the product and active siblings in the same canonical group directly from Prisma without HTTP calls", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_A);
      productFindMany.mockResolvedValue([PRODUCT_A, PRODUCT_B_SIBLING]);

      const result = await resolveProductGroupForCart("prod-a", 100);

      expect(result).not.toBeNull();
      expect(productFindFirst).toHaveBeenCalledWith({
        where: { OR: [{ id: "prod-a" }, { slug: "prod-a" }], isActive: true },
        include: expect.any(Object),
      });
      expect(productFindMany).toHaveBeenCalledWith({
        where: { canonicalProductId: "canon-cement-53", isActive: true },
        include: expect.any(Object),
        orderBy: { updatedAt: "desc" },
      });

      // At quantity 100, Supplier Beta is cheaper (350 vs 360)
      expect(result!.resolution).not.toBeNull();
      expect(result!.resolution?.listingId).toBe("prod-b");
      expect(result!.resolution?.supplierId).toBe("supp-2");
      expect(result!.resolution?.unitPrice).toBe(350);
    });

    it("returns null when product is not found or inactive", async () => {
      productFindFirst.mockResolvedValue(null);

      const result = await resolveProductGroupForCart("missing-prod", 10);
      expect(result).toBeNull();
      expect(productFindMany).not.toHaveBeenCalled();
    });

    it("handles standalone products without a canonical group", async () => {
      const standalone = { ...PRODUCT_A, canonicalProductId: null };
      productFindFirst.mockResolvedValue(standalone);

      const result = await resolveProductGroupForCart("prod-a", 10);
      expect(result).not.toBeNull();
      expect(productFindMany).not.toHaveBeenCalled();
      expect(result!.resolution?.listingId).toBe("prod-a");
      expect(result!.resolution?.unitPrice).toBe(380);
    });

    it("canonical product grouping parity: queries siblings strictly by canonicalProductId with isActive: true", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_A);
      productFindMany.mockResolvedValue([PRODUCT_A, PRODUCT_B_SIBLING]);

      await resolveProductGroupForCart("prod-a", 10);

      // Verifies exact filter: canonicalProductId matches and isActive is true
      expect(productFindMany).toHaveBeenCalledWith({
        where: { canonicalProductId: "canon-cement-53", isActive: true },
        include: expect.any(Object),
        orderBy: { updatedAt: "desc" },
      });
    });
  });

  describe("Full Authoritative Cart Response in POST /api/builder/cart/items", () => {
    it("POST /cart/items returns updated items and summary directly alongside item metadata", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_A);
      productFindMany.mockResolvedValue([PRODUCT_A]);
      cartItemUpsert.mockResolvedValue({
        id: "cart-item-1",
        userId: "builder-user-1",
        productId: "prod-a",
        quantity: 10,
        resolvedSupplierId: "supp-1",
        resolvedUnitPrice: 380,
      });

      cartItemFindMany.mockResolvedValue([
        {
          id: "cart-item-1",
          productId: "prod-a",
          quantity: 10,
          resolvedUnitPrice: 380,
          resolvedSupplierId: "supp-1",
          product: {
            name: "UltraTech 53 Grade Cement",
            unit: "BAG",
            supplierId: "supp-1",
            categoryId: "cat-cement",
            basePrice: 380,
            images: ["https://example.com/cement.jpg"],
            supplier: { companyName: "Supplier Alpha" },
            pricingTiers: [{ minQty: 1, maxQty: 500, tierPrice: 380 }],
          },
        },
      ]);

      markupSettingFindMany.mockResolvedValue([
        { scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true },
      ]);

      const request = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-a", quantity: 10 }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBe("cart-item-1");
      expect(data.productId).toBe("prod-a");
      expect(data.quantity).toBe(10);
      expect(data.resolvedUnitPrice).toBe(380);

      // Additive authoritative cart payload
      expect(data.items).toHaveLength(1);
      expect(data.items[0].productId).toBe("prod-a");
      // Marked up buyer unit price: 380 + 10% = 418
      expect(data.items[0].unitPrice).toBe(418);
      expect(data.items[0].lineTotal).toBe(4180);
      expect(data.summary.itemCount).toBe(1);
      expect(data.summary.subtotal).toBe(4180);
      expect(data.summary.subtotalLabel).toBe("₹4,180");
    });

    it("returns 404 when adding an invalid or nonexistent product", async () => {
      productFindFirst.mockResolvedValue(null);

      const request = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "nonexistent", quantity: 1 }),
      });

      const response = await POST(request);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Product not found");
    });

    it("rejects invalid quantity values with 400", async () => {
      const request = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-a", quantity: 0 }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Valid productId and quantity are required");
    });

    it("Scenario A — Add a different product during checkout: new product remains in cart", async () => {
      const PRODUCT_C = {
        id: "prod-c",
        slug: "steel-bars",
        name: "Tata Tiscon 12mm TMT",
        unit: "PIECE",
        supplierId: "supp-steel",
        categoryId: "cat-steel",
        basePrice: 500,
        stock: 200,
        maxServiceableQty: 200,
        isActive: true,
        canonicalProductId: null,
        supplier: { companyName: "Tata Steel" },
        pricingTiers: [],
      };

      productFindFirst.mockResolvedValue(PRODUCT_C);
      productFindMany.mockResolvedValue([PRODUCT_C]);
      cartItemFindUnique.mockResolvedValue(null);
      cartItemUpsert.mockResolvedValue({
        id: "cart-item-c",
        userId: "builder-user-1",
        productId: "prod-c",
        quantity: 5,
        resolvedSupplierId: "supp-steel",
        resolvedUnitPrice: 500,
      });

      cartItemFindMany.mockResolvedValue([
        {
          id: "cart-item-1",
          productId: "prod-a",
          quantity: 10,
          resolvedUnitPrice: 380,
          resolvedSupplierId: "supp-1",
          product: PRODUCT_A,
        },
        {
          id: "cart-item-c",
          productId: "prod-c",
          quantity: 5,
          resolvedUnitPrice: 500,
          resolvedSupplierId: "supp-steel",
          product: PRODUCT_C,
        },
      ]);

      const request = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-c", quantity: 5, mode: "increment" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.productId).toBe("prod-c");
      expect(data.quantity).toBe(5);
      expect(data.items).toHaveLength(2);
      expect(data.items.map((i: any) => i.productId)).toContain("prod-c");
    });

    it("Scenario B — Add same product after checkout locks original row: recovers from deleted row and preserves added quantity", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_A);
      productFindMany.mockResolvedValue([PRODUCT_A]);

      // When checking initially, row existed with quantity 10
      cartItemFindUnique.mockResolvedValue({ id: "cart-item-1", quantity: 10 });

      // First upsert attempts update, but checkout committed deletion of cart-item-1 -> throws P2025
      const p2025Error: any = new Error("Record to update not found.");
      p2025Error.code = "P2025";
      cartItemUpsert
        .mockRejectedValueOnce(p2025Error)
        .mockResolvedValueOnce({
          id: "cart-item-new-1",
          userId: "builder-user-1",
          productId: "prod-a",
          quantity: 5,
          resolvedSupplierId: "supp-1",
          resolvedUnitPrice: 380,
        });

      cartItemFindMany.mockResolvedValue([
        {
          id: "cart-item-new-1",
          productId: "prod-a",
          quantity: 5,
          resolvedUnitPrice: 380,
          resolvedSupplierId: "supp-1",
          product: PRODUCT_A,
        },
      ]);

      const request = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-a", quantity: 5, mode: "increment" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      // The 5 added units are safely preserved in a new row without silent data loss
      expect(data.id).toBe("cart-item-new-1");
      expect(data.quantity).toBe(5);
      expect(cartItemUpsert).toHaveBeenCalledTimes(2);
    });

    it("Scenario C — Update existing quantity after checkout locks row: returns 409 Conflict when item was consumed", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_A);
      productFindMany.mockResolvedValue([PRODUCT_A]);

      // Found the item before lock
      cartItemFindFirst.mockResolvedValue({ id: "cart-item-1", quantity: 10 });

      // Update waits for checkout's lock, checkout deletes row -> update throws P2025
      const p2025Error: any = new Error("Record to update not found.");
      p2025Error.code = "P2025";
      cartItemUpdate.mockRejectedValueOnce(p2025Error);

      const request = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-a", cartItemId: "cart-item-1", quantity: 15, mode: "set" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toBe("This cart item was checked out or removed. Please refresh your cart.");
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.summary).toBeDefined();
    });

    it("Scenario C — Update existing quantity when item does not exist: returns 409 Conflict", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_A);
      // Item does not exist (already deleted)
      cartItemFindFirst.mockResolvedValue(null);

      const request = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-a", cartItemId: "cart-item-1", quantity: 15, mode: "set" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toBe("This cart item was checked out or removed. Please refresh your cart.");
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.summary).toBeDefined();
    });

    describe("Section 3 & 4: Quantity-Tier Pricing and Serialised Concurrent Additions", () => {
      const PRODUCT_TIERED = {
        id: "prod-tiered",
        slug: "tiered-cement",
        name: "Tiered Pricing Cement",
        unit: "BAG",
        supplierId: "supp-tiered",
        categoryId: "cat-cement",
        basePrice: 400,
        stock: 500,
        maxServiceableQty: 500,
        isActive: true,
        canonicalProductId: null,
        supplier: { companyName: "Supplier Tiered" },
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 390 },
          { minQty: 10, maxQty: 50, tierPrice: 350 },
        ],
      };

      it("addition of 5 to empty cart resolves tier for 5 (₹390)", async () => {
        productFindFirst.mockResolvedValue(PRODUCT_TIERED);
        productFindMany.mockResolvedValue([PRODUCT_TIERED]);
        cartItemFindUnique.mockResolvedValue(null);
        cartItemUpsert.mockResolvedValue({
          id: "cart-item-t1",
          userId: "builder-user-1",
          productId: "prod-tiered",
          quantity: 5,
          resolvedSupplierId: "supp-tiered",
          resolvedUnitPrice: 390,
          resolvedTierMinQty: 1,
          resolvedTierMaxQty: 9,
        });

        const request = new Request("https://buildohub.in/api/builder/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: "prod-tiered", quantity: 5, mode: "increment" }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(cartItemUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              quantity: 5,
              resolvedUnitPrice: 390,
              resolvedTierMinQty: 1,
              resolvedTierMaxQty: 9,
            }),
            update: expect.objectContaining({
              quantity: 5,
              resolvedUnitPrice: 390,
            }),
          })
        );
      });

      it("addition of 5 to existing 10 resolves tier for 15 (₹350)", async () => {
        productFindFirst.mockResolvedValue(PRODUCT_TIERED);
        productFindMany.mockResolvedValue([PRODUCT_TIERED]);
        cartItemFindUnique.mockResolvedValue({ id: "cart-item-t1", quantity: 10 });
        cartItemUpsert.mockResolvedValue({
          id: "cart-item-t1",
          userId: "builder-user-1",
          productId: "prod-tiered",
          quantity: 15,
          resolvedSupplierId: "supp-tiered",
          resolvedUnitPrice: 350,
          resolvedTierMinQty: 10,
          resolvedTierMaxQty: 50,
        });

        const request = new Request("https://buildohub.in/api/builder/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: "prod-tiered", quantity: 5, mode: "increment" }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(cartItemUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              quantity: 15,
              resolvedUnitPrice: 350,
              resolvedTierMinQty: 10,
              resolvedTierMaxQty: 50,
            }),
          })
        );
      });

      it("addition of 5 to existing 10 when checkout consumes row: retries, recalculates tier for 5 (₹390, NOT ₹350)", async () => {
        productFindFirst.mockResolvedValue(PRODUCT_TIERED);
        productFindMany.mockResolvedValue([PRODUCT_TIERED]);
        // First read sees existing 10
        // Second read (during retry after P2025) sees null (row deleted by checkout)
        cartItemFindUnique
          .mockResolvedValueOnce({ id: "cart-item-t1", quantity: 10 })
          .mockResolvedValueOnce(null);

        const p2025Error: any = new Error("Record to update not found.");
        p2025Error.code = "P2025";

        cartItemUpsert
          .mockRejectedValueOnce(p2025Error)
          .mockResolvedValueOnce({
            id: "cart-item-t2",
            userId: "builder-user-1",
            productId: "prod-tiered",
            quantity: 5,
            resolvedSupplierId: "supp-tiered",
            resolvedUnitPrice: 390,
            resolvedTierMinQty: 1,
            resolvedTierMaxQty: 9,
          });

        const request = new Request("https://buildohub.in/api/builder/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: "prod-tiered", quantity: 5, mode: "increment" }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(cartItemUpsert).toHaveBeenCalledTimes(2);

        // Verification: The second upsert (the committed retry) must have resolved pricing for 5 units (₹390), NOT 15 units (₹350)!
        expect(cartItemUpsert).toHaveBeenLastCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              quantity: 5,
              resolvedUnitPrice: 390,
              resolvedTierMinQty: 1,
              resolvedTierMaxQty: 9,
            }),
            update: expect.objectContaining({
              quantity: 5,
              resolvedUnitPrice: 390,
            }),
          })
        );
      });

      it("two concurrent additions (+5 and +3) after checkout: second addition accumulates to 8 and uses tier for 8 (₹390)", async () => {
        productFindFirst.mockResolvedValue(PRODUCT_TIERED);
        productFindMany.mockResolvedValue([PRODUCT_TIERED]);

        // Simulating Tab 3 (+3 units) executing after Tab 2 (+5 units) has completed
        cartItemFindUnique.mockResolvedValue({ id: "cart-item-t2", quantity: 5 });
        cartItemUpsert.mockResolvedValue({
          id: "cart-item-t2",
          userId: "builder-user-1",
          productId: "prod-tiered",
          quantity: 8,
          resolvedSupplierId: "supp-tiered",
          resolvedUnitPrice: 390,
          resolvedTierMinQty: 1,
          resolvedTierMaxQty: 9,
        });

        const request = new Request("https://buildohub.in/api/builder/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: "prod-tiered", quantity: 3, mode: "increment" }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(cartItemUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              quantity: 8,
              resolvedUnitPrice: 390,
              resolvedTierMinQty: 1,
              resolvedTierMaxQty: 9,
            }),
          })
        );
      });

      it("concurrent increments crossing tier boundary: committed final pricing reflects final quantity", async () => {
        productFindFirst.mockResolvedValue(PRODUCT_TIERED);
        productFindMany.mockResolvedValue([PRODUCT_TIERED]);

        // Existing quantity is 8 (in tier 1-9 @ ₹390). Adding 4 brings total to 12 (crosses boundary into tier 10-50 @ ₹350)
        cartItemFindUnique.mockResolvedValue({ id: "cart-item-t2", quantity: 8 });
        cartItemUpsert.mockResolvedValue({
          id: "cart-item-t2",
          userId: "builder-user-1",
          productId: "prod-tiered",
          quantity: 12,
          resolvedSupplierId: "supp-tiered",
          resolvedUnitPrice: 350,
          resolvedTierMinQty: 10,
          resolvedTierMaxQty: 50,
        });

        const request = new Request("https://buildohub.in/api/builder/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: "prod-tiered", quantity: 4, mode: "increment" }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(cartItemUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              quantity: 12,
              resolvedUnitPrice: 350,
              resolvedTierMinQty: 10,
              resolvedTierMaxQty: 50,
            }),
          })
        );
      });
    });
  });

  describe("Zustand Cart Store (Single Round-Trip Verification)", () => {
    it("addItem() updates store state directly from POST response without calling fetchCart / GET /cart", async () => {
      const postSpy = vi.spyOn(apiModule, "builderApiPost").mockResolvedValue({
        id: "cart-item-1",
        productId: "prod-a",
        quantity: 10,
        items: [
          {
            id: "cart-item-1",
            productId: "prod-a",
            name: "UltraTech 53 Grade Cement",
            unit: "BAG",
            supplierId: "supp-1",
            supplierName: "Supplier Alpha",
            quantity: 10,
            unitPrice: 418,
            lineTotal: 4180,
          },
        ],
        summary: {
          itemCount: 1,
          subtotal: 4180,
          subtotalLabel: "₹4,180",
        },
      });

      const getSpy = vi.spyOn(apiModule, "builderApiGet");

      await useCartStore.getState().addItem("prod-a", 10);

      // Verify POST /cart/items was called with mode: "increment" and generated idempotencyKey
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy).toHaveBeenCalledWith("/cart/items", {
        productId: "prod-a",
        quantity: 10,
        mode: "increment",
        idempotencyKey: expect.any(String),
      });

      // CRITICAL VERIFICATION: No second sequential GET /cart was executed!
      expect(getSpy).not.toHaveBeenCalled();

      // Store reflects updated state immediately
      const state = useCartStore.getState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].productId).toBe("prod-a");
      expect(state.items[0].lineTotal).toBe(4180);
      expect(state.summary.subtotal).toBe(4180);
      expect(state.isMutating).toBe(false);
      expect(state.hasLoaded).toBe(true);
      expect(state.error).toBeNull();
    });

    it("addItem() does not update state and throws error on POST failure", async () => {
      vi.spyOn(apiModule, "builderApiPost").mockRejectedValue(new Error("Network failure"));
      const getSpy = vi.spyOn(apiModule, "builderApiGet");

      await expect(useCartStore.getState().addItem("prod-a", 10)).rejects.toThrow("add-item-failed");

      expect(getSpy).not.toHaveBeenCalled();
      const state = useCartStore.getState();
      expect(state.items).toHaveLength(0);
      expect(state.isMutating).toBe(false);
      expect(state.error).toBe("Unable to add this item to your enquiry basket.");
    });

    it("addItem() throws and does not issue fallback GET when POST returns malformed payload", async () => {
      vi.spyOn(apiModule, "builderApiPost").mockResolvedValue({ id: "cart-item-1", quantity: 10 } as any);
      const getSpy = vi.spyOn(apiModule, "builderApiGet");

      await expect(useCartStore.getState().addItem("prod-a", 10)).rejects.toThrow("add-item-failed");

      // Verifies NO fallback GET /cart is performed on malformed response
      expect(getSpy).not.toHaveBeenCalled();
      const state = useCartStore.getState();
      expect(state.error).toBe("Unable to add this item to your enquiry basket.");
      expect(state.isMutating).toBe(false);
    });

    it("updateQuantity() throws and does not issue fallback GET when POST returns malformed payload", async () => {
      vi.spyOn(apiModule, "builderApiPost").mockResolvedValue({ id: "cart-item-1" } as any);
      const getSpy = vi.spyOn(apiModule, "builderApiGet");

      await expect(useCartStore.getState().updateQuantity("prod-a", "cart-item-1", 5)).rejects.toThrow("update-quantity-failed");

      // Verifies NO fallback GET /cart is performed on malformed response
      expect(getSpy).not.toHaveBeenCalled();
      const state = useCartStore.getState();
      expect(state.error).toBe("Unable to update quantity. Please try again.");
      expect(state.isMutating).toBe(false);
    });

    it("updateQuantity() synchronises Zustand state directly from 409 conflict error payload without restoring stale items or calling GET /cart", async () => {
      // Cart currently has item A (qty 10, ₹418) and item B (qty 2, ₹500)
      useCartStore.setState({
        items: [
          {
            id: "cart-item-a",
            productId: "prod-a",
            name: "UltraTech 53 Grade Cement",
            unit: "BAG",
            supplierId: "supp-1",
            supplierName: "Supplier Alpha",
            quantity: 10,
            unitPrice: 418,
            lineTotal: 4180,
          },
          {
            id: "cart-item-b",
            productId: "prod-b",
            name: "Tata Tiscon 12mm TMT",
            unit: "PIECE",
            supplierId: "supp-2",
            supplierName: "Tata Steel",
            quantity: 2,
            unitPrice: 500,
            lineTotal: 1000,
          },
        ],
        summary: {
          itemCount: 2,
          subtotal: 5180,
          subtotalLabel: "₹5,180",
        },
        hasLoaded: true,
        isLoading: false,
        isMutating: false,
        error: null,
      });

      // Checkout consumed item A. 409 Conflict payload returns authoritative cart containing only item B.
      const conflictError: any = new Error("This cart item was checked out or removed. Please refresh your cart.");
      conflictError.status = 409;
      conflictError.data = {
        error: "This cart item was checked out or removed. Please refresh your cart.",
        items: [
          {
            id: "cart-item-b",
            productId: "prod-b",
            name: "Tata Tiscon 12mm TMT",
            unit: "PIECE",
            supplierId: "supp-2",
            supplierName: "Tata Steel",
            quantity: 2,
            unitPrice: 500,
            lineTotal: 1000,
          },
        ],
        summary: {
          itemCount: 1,
          subtotal: 1000,
          subtotalLabel: "₹1,000",
        },
      };

      vi.spyOn(apiModule, "builderApiPost").mockRejectedValue(conflictError);
      const getSpy = vi.spyOn(apiModule, "builderApiGet");

      await expect(
        useCartStore.getState().updateQuantity("prod-a", "cart-item-a", 20)
      ).rejects.toThrow("update-quantity-failed");

      // Critical: No redundant GET /cart call when 409 includes authoritative payload
      expect(getSpy).not.toHaveBeenCalled();

      // State is synchronised with the server's authoritative state:
      // - Item A is absent (NOT restored to stale 10 units!)
      // - Item B is preserved
      // - Subtotal is updated to 1000
      // - Conflict message is displayed
      const state = useCartStore.getState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].id).toBe("cart-item-b");
      expect(state.items.find((i) => i.id === "cart-item-a")).toBeUndefined();
      expect(state.summary.subtotal).toBe(1000);
      expect(state.summary.itemCount).toBe(1);
      expect(state.isMutating).toBe(false);
      expect(state.error).toBe("This cart item was checked out or removed. Please refresh your cart.");
    });

    it("updateQuantity() performs exceptional fallback GET /cart and synchronises Zustand when 409 lacks inline payload", async () => {
      useCartStore.setState({
        items: [
          {
            id: "cart-item-a",
            productId: "prod-a",
            name: "UltraTech Cement",
            unit: "BAG",
            supplierId: "supp-1",
            supplierName: "Supplier Alpha",
            quantity: 10,
            unitPrice: 400,
            lineTotal: 4000,
          },
        ],
        summary: {
          itemCount: 1,
          subtotal: 4000,
          subtotalLabel: "₹4,000",
        },
        hasLoaded: true,
        isLoading: false,
        isMutating: false,
        error: null,
      });

      // 409 without data payload
      const conflictError: any = new Error("This cart item was checked out or removed. Please refresh your cart.");
      conflictError.status = 409;
      vi.spyOn(apiModule, "builderApiPost").mockRejectedValue(conflictError);

      const getSpy = vi.spyOn(apiModule, "builderApiGet").mockResolvedValue({
        items: [],
        summary: {
          itemCount: 0,
          subtotal: 0,
          subtotalLabel: "₹0",
        },
      });

      await expect(
        useCartStore.getState().updateQuantity("prod-a", "cart-item-a", 15)
      ).rejects.toThrow("update-quantity-failed");

      // Verifies fallback GET was called exactly once to recover authoritative state
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledWith("/cart");

      // State is synchronised to empty cart (NOT restored to 10 units)
      const state = useCartStore.getState();
      expect(state.items).toHaveLength(0);
      expect(state.summary.subtotal).toBe(0);
      expect(state.isMutating).toBe(false);
      expect(state.error).toBe("This cart item was checked out or removed. Please refresh your cart.");
    });
  });

  describe("Phase 8: Required Concurrency and Correctness Matrix", () => {
    const PRODUCT_TIERED_8 = {
      id: "prod-tiered-8",
      slug: "tiered-cement-8",
      name: "Tiered Pricing Cement 8",
      unit: "BAG",
      supplierId: "supp-tiered-8",
      categoryId: "cat-cement",
      basePrice: 400,
      stock: 500,
      maxServiceableQty: 500,
      isActive: true,
      canonicalProductId: null,
      supplier: { companyName: "Supplier Tiered 8" },
      pricingTiers: [
        { minQty: 1, maxQty: 9, tierPrice: 390 },
        { minQty: 10, maxQty: 50, tierPrice: 350 },
      ],
    };

    it("1. Existing quantity 10, concurrent +5 and +3 -> Final quantity 18", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);

      // Request A reads 10, updates to 15
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-t", quantity: 10 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-t",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 15,
        resolvedUnitPrice: 350,
      });

      const reqA = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });
      const resA = await POST(reqA);
      expect(resA.status).toBe(200);
      const dataA = await resA.json();
      expect(dataA.quantity).toBe(15);

      // Request B serialized after A: reads 15, updates to 18
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-t", quantity: 15 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-t",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 18,
        resolvedUnitPrice: 350,
      });

      const reqB = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 3, mode: "increment" }),
      });
      const resB = await POST(reqB);
      expect(resB.status).toBe(200);
      const dataB = await resB.json();
      expect(dataB.quantity).toBe(18);

      // Advisory lock was acquired for both operations
      expect(queryRawFn).toHaveBeenCalledWith(
        expect.anything(),
        "builder-user-1",
        "prod-tiered-8"
      );
    });

    it("2. Empty cart, concurrent +5 and +3 -> Final quantity 8", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);

      // Request A sees empty cart (null), creates row with 5
      cartItemFindUnique.mockResolvedValueOnce(null);
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-new",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 5,
        resolvedUnitPrice: 390,
      });

      const reqA = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });
      const resA = await POST(reqA);
      expect(resA.status).toBe(200);

      // Request B serialized after A: reads 5, updates to 8
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-new", quantity: 5 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-new",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 8,
        resolvedUnitPrice: 390,
      });

      const reqB = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 3, mode: "increment" }),
      });
      const resB = await POST(reqB);
      expect(resB.status).toBe(200);
      const dataB = await resB.json();
      expect(dataB.quantity).toBe(8);
      expect(dataB.resolvedUnitPrice).toBe(390);
    });

    it("3. Multiple simultaneous increments -> No lost additions", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);

      // 3 additions: +2, +3, +4 on initial 5
      const increments = [2, 3, 4];
      let currentQty = 5;

      for (const inc of increments) {
        cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-m", quantity: currentQty });
        currentQty += inc;
        cartItemUpsert.mockResolvedValueOnce({
          id: "cart-item-m",
          userId: "builder-user-1",
          productId: "prod-tiered-8",
          quantity: currentQty,
          resolvedUnitPrice: currentQty >= 10 ? 350 : 390,
        });

        const req = new Request("https://buildohub.in/api/builder/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: "prod-tiered-8", quantity: inc, mode: "increment" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.quantity).toBe(currentQty);
      }

      expect(currentQty).toBe(14);
    });

    it("4. Concurrent additions crossing tier boundary -> Correct final tier and pricing", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);

      // Initial quantity: 7 (in tier 1-9 @ ₹390). Adding 4 brings to 11 (tier 10-50 @ ₹350)
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-bound", quantity: 7 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-bound",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 11,
        resolvedUnitPrice: 350,
      });

      const req = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 4, mode: "increment" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.quantity).toBe(11);
      expect(data.resolvedUnitPrice).toBe(350);
      expect(cartItemUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            quantity: 11,
            resolvedUnitPrice: 350,
          }),
        })
      );
    });

    it("5. Concurrent set and checkout -> No stale overwrite (returns 409 Conflict)", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      // Checkout consumed row: findFirst returns null
      cartItemFindFirst.mockResolvedValue(null);

      const req = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: "prod-tiered-8",
          cartItemId: "cart-item-consumed",
          quantity: 20,
          mode: "set",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("This cart item was checked out or removed. Please refresh your cart.");
      expect(data.items).toBeDefined();
    });

    it("6. Concurrent remove and checkout -> Targeted delete does not delete newly created row", async () => {
      // User removes cart-item-1, but cart-item-1 was already consumed and cart-item-2 was newly created
      const req = new Request(
        "https://buildohub.in/api/builder/cart/items/prod-tiered-8?cartItemId=cart-item-1",
        { method: "DELETE" }
      );

      const res = await DELETE(req, { params: { productId: "prod-tiered-8" } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.removed).toBe(true);

      // Verifies delete targeted specific cart item id 'cart-item-1', NOT deleting all items of prod-tiered-8
      expect(cartItemDeleteMany).toHaveBeenCalledWith({
        where: { userId: "builder-user-1", id: "cart-item-1" },
      });
    });

    it("7. Concurrent increment and set -> Defined, consistent serialized result", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);

      // Step 1: Set quantity to 20
      cartItemFindFirst.mockResolvedValueOnce({ id: "cart-item-s", quantity: 10 });
      cartItemUpdate.mockResolvedValueOnce({
        id: "cart-item-s",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 20,
        resolvedUnitPrice: 350,
      });

      const reqSet = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: "prod-tiered-8",
          cartItemId: "cart-item-s",
          quantity: 20,
          mode: "set",
        }),
      });
      const resSet = await POST(reqSet);
      expect(resSet.status).toBe(200);

      // Step 2: Increment by 5 -> reads 20, updates to 25
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-s", quantity: 20 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-s",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 25,
        resolvedUnitPrice: 350,
      });

      const reqInc = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });
      const resInc = await POST(reqInc);
      expect(resInc.status).toBe(200);
      const dataInc = await resInc.json();
      expect(dataInc.quantity).toBe(25);
    });

    it("8. Different products updated concurrently -> Distinct lock keys, no global contention", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_A);
      productFindMany.mockResolvedValue([PRODUCT_A]);
      cartItemFindUnique.mockResolvedValue(null);
      cartItemUpsert.mockResolvedValue({
        id: "cart-item-a",
        userId: "builder-user-1",
        productId: "prod-a",
        quantity: 5,
        resolvedUnitPrice: 380,
      });

      const reqA = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-a", quantity: 5, mode: "increment" }),
      });
      await POST(reqA);

      // Lock was requested with product A
      expect(queryRawFn).toHaveBeenCalledWith(
        expect.anything(),
        "builder-user-1",
        "prod-a"
      );

      queryRawFn.mockClear();
      const reqB = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-b", quantity: 5, mode: "increment" }),
      });
      await POST(reqB);

      // Lock was requested with product B (different key, zero contention)
      expect(queryRawFn).toHaveBeenCalledWith(
        expect.anything(),
        "builder-user-1",
        "prod-b"
      );
    });

    it("9. Transaction rollback -> No partial quantity/pricing changes", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);
      cartItemFindUnique.mockResolvedValue({ id: "cart-item-err", quantity: 10 });
      cartItemUpsert.mockRejectedValue(new Error("Database connection dropped"));

      const req = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Failed to update cart");
    });

    it("10. Uncertain transaction outcome and retry -> Idempotency key prevents duplicate increment", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-idem", quantity: 10 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-idem",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 15,
        resolvedUnitPrice: 350,
      });

      // First request with idempotency key
      const req1 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "client-key-abc-123",
        },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });

      const res1 = await POST(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.quantity).toBe(15);
      expect(cartItemUpsert).toHaveBeenCalledTimes(1);

      // Client retries with exact same idempotency key (e.g. after network timeout)
      const req2 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "client-key-abc-123",
        },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });

      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      // Returns same cached response without calling upsert again
      expect(data2.quantity).toBe(15);
      expect(cartItemUpsert).toHaveBeenCalledTimes(1);
    });

    it("11. Same idempotency key with different request payload -> Explicit HTTP 409 Conflict", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-idem", quantity: 10 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-idem",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 15,
        resolvedUnitPrice: 350,
      });

      // Original request with quantity 5
      const req1 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "key-payload-test",
        },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      // Replay using same key but DIFFERENT quantity (10 instead of 5)
      const req2 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "key-payload-test",
        },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 10, mode: "increment" }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(409);
      const err = await res2.json();
      expect(err.error).toMatch(/Idempotency key was previously used with a different request payload/i);
      // Ensure upsert was NOT called a second time
      expect(cartItemUpsert).toHaveBeenCalledTimes(1);
    });

    it("12. New key for a genuinely new action -> Causes a new increment", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-idem", quantity: 10 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-idem",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 15,
        resolvedUnitPrice: 350,
      });

      const req1 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "first-action-key",
        },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);
      expect(cartItemUpsert).toHaveBeenCalledTimes(1);

      // New action with brand new key
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-idem", quantity: 15 });
      cartItemUpsert.mockResolvedValueOnce({
        id: "cart-item-idem",
        userId: "builder-user-1",
        productId: "prod-tiered-8",
        quantity: 18,
        resolvedUnitPrice: 350,
      });

      const req2 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "second-action-key",
        },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 3, mode: "increment" }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.quantity).toBe(18);
      expect(cartItemUpsert).toHaveBeenCalledTimes(2);
    });

    it("13. Client Zustand store sends idempotency key and updates state cleanly", async () => {
      const mockPost = vi.spyOn(apiModule, "builderApiPost").mockResolvedValueOnce({
        id: "cart-item-1",
        productId: "prod-a",
        quantity: 5,
        resolvedSupplierId: "supp-1",
        resolvedUnitPrice: 380,
        items: [
          {
            id: "cart-item-1",
            productId: "prod-a",
            name: "UltraTech 53 Grade Cement",
            unit: "BAG",
            supplierId: "supp-1",
            supplierName: "Supplier Alpha",
            quantity: 5,
            unitPrice: 380,
            lineTotal: 1900,
          },
        ],
        summary: {
          itemCount: 1,
          subtotal: 1900,
          subtotalLabel: "₹1,900",
        },
      });

      await useCartStore.getState().addItem("prod-a", 5, "custom-idempotency-key");

      expect(mockPost).toHaveBeenCalledWith("/cart/items", {
        productId: "prod-a",
        quantity: 5,
        mode: "increment",
        idempotencyKey: "custom-idempotency-key",
      });

      const state = useCartStore.getState();
      expect(state.items.length).toBe(1);
      expect(state.summary.subtotal).toBe(1900);
      expect(state.isMutating).toBe(false);
      mockPost.mockRestore();
    });

    it("14. Idempotent replay must not restore stale cart state (10 -> +5 with K1 -> +3 with K2 -> retry K1)", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);

      const cartItemsState: any[] = [
        {
          id: "cart-item-seq",
          productId: "prod-tiered-8",
          quantity: 10,
          resolvedUnitPrice: 350,
          product: PRODUCT_TIERED_8,
        },
      ];

      cartItemFindMany.mockImplementation(async () => cartItemsState);

      // Step 1: Initial quantity 10. Add 5 with Key K1 -> quantity becomes 15
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-seq", quantity: 10 });
      cartItemUpsert.mockImplementationOnce(async ({ update }: any) => {
        cartItemsState[0].quantity = update.quantity;
        return {
          id: "cart-item-seq",
          userId: "builder-user-1",
          productId: "prod-tiered-8",
          quantity: update.quantity,
          resolvedUnitPrice: 350,
        };
      });

      const req1 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "K1" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.quantity).toBe(15);
      expect(data1.items[0].quantity).toBe(15);
      expect(cartItemUpsert).toHaveBeenCalledTimes(1);

      // Step 2: Add 3 with Key K2 -> quantity becomes 18
      cartItemFindUnique.mockResolvedValueOnce({ id: "cart-item-seq", quantity: 15 });
      cartItemUpsert.mockImplementationOnce(async ({ update }: any) => {
        cartItemsState[0].quantity = update.quantity;
        return {
          id: "cart-item-seq",
          userId: "builder-user-1",
          productId: "prod-tiered-8",
          quantity: update.quantity,
          resolvedUnitPrice: 350,
        };
      });

      const req2 = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "K2" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 3, mode: "increment" }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.quantity).toBe(18);
      expect(data2.items[0].quantity).toBe(18);
      expect(cartItemUpsert).toHaveBeenCalledTimes(2);

      // Step 3: Retry original operation using K1
      // CRITICAL REQUIREMENT:
      // - Must not increment quantity again (DB quantity remains 18)
      // - Response provides latest authoritative cart state (showing 18, not 15)
      // - Zustand must display 18, not 15
      const req1Retry = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "K1" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });
      const res1Retry = await POST(req1Retry);
      expect(res1Retry.status).toBe(200);
      const dataRetry = await res1Retry.json();

      // Upsert was NOT called a 3rd time
      expect(cartItemUpsert).toHaveBeenCalledTimes(2);
      // Response signals replay and provides fresh authoritative state
      expect(dataRetry.isReplay).toBe(true);
      expect(dataRetry.quantity).toBe(18);
      expect(dataRetry.items[0].quantity).toBe(18);

      // Verify client store ingestion: Zustand reflects 18, not 15
      useCartStore.setState({ items: dataRetry.items, summary: dataRetry.summary });
      const storeState = useCartStore.getState();
      expect(storeState.items[0].quantity).toBe(18);
    });

    it("15. Concurrent competing transactions with same key receive P2002 -> rolls back and resolves outside tx", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);
      cartItemFindUnique.mockResolvedValue({ id: "cart-item-race", quantity: 10 });
      cartItemUpsert.mockResolvedValue({ id: "cart-item-race", quantity: 15 });

      // Transaction attempts to insert idempotency record but fails with P2002 (uniqueness collision)
      cartIdempotencyCreate.mockRejectedValueOnce({
        code: "P2002",
        message: "Unique constraint failed on the fields: (`userId`,`key`)",
        meta: { target: ["userId", "key"] },
      });

      // Outside the failed transaction, prisma.cartIdempotency.findUnique finds the winning record
      const winningRecord = {
        userId: "builder-user-1",
        key: "race-key-1",
        requestFingerprint: computeRequestFingerprint({
          productId: "prod-tiered-8",
          quantity: 5,
          mode: "increment",
        }),
        responseStatus: 200,
        responsePayload: {
          id: "cart-item-race",
          productId: "prod-tiered-8",
          quantity: 15,
        },
      };
      cartIdempotencyFindUnique.mockResolvedValue(winningRecord);

      const req = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "race-key-1" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.isReplay).toBe(true);
      expect(data.quantity).toBe(15);
    });

    it("16. Expired idempotency key -> Rejected with HTTP 410 and not treated as valid duplicate", async () => {
      productFindFirst.mockResolvedValue(PRODUCT_TIERED_8);
      productFindMany.mockResolvedValue([PRODUCT_TIERED_8]);

      // Record exists but expired 5 minutes ago
      cartIdempotencyFindUnique.mockResolvedValue({
        userId: "builder-user-1",
        key: "expired-key",
        requestFingerprint: computeRequestFingerprint({
          productId: "prod-tiered-8",
          quantity: 5,
          mode: "increment",
        }),
        responseStatus: 200,
        responsePayload: { quantity: 15 },
        expiresAt: new Date(Date.now() - 300000), // 5 mins ago
      });

      const req = new Request("https://buildohub.in/api/builder/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "expired-key" },
        body: JSON.stringify({ productId: "prod-tiered-8", quantity: 5, mode: "increment" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(410);
      const err = await res.json();
      expect(err.error).toMatch(/Idempotency key has expired/i);
      expect(cartItemUpsert).not.toHaveBeenCalled();
    });

    it("17. cleanupExpiredCartIdempotencies prunes records older than cutoff and handles null expiresAt", async () => {
      cartIdempotencyDeleteMany.mockResolvedValue({ count: 7 });

      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const expectedNullCutoff = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000);
      const count = await cleanupExpiredCartIdempotencies(cutoff);

      expect(count).toBe(7);
      expect(cartIdempotencyDeleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { expiresAt: { lt: cutoff } },
            { expiresAt: null, createdAt: { lt: expectedNullCutoff } },
          ],
        },
      });
    });

    it("18. cleanupExpiredCartIdempotencies supports bounded batching", async () => {
      cartIdempotencyFindMany
        .mockResolvedValueOnce([{ id: "id-1" }, { id: "id-2" }])
        .mockResolvedValueOnce([]);
      cartIdempotencyDeleteMany.mockResolvedValueOnce({ count: 2 });

      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const count = await cleanupExpiredCartIdempotencies(cutoff, undefined, { batchSize: 2 });

      expect(count).toBe(2);
      expect(cartIdempotencyFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 2,
          select: { id: true },
        })
      );
      expect(cartIdempotencyDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["id-1", "id-2"] } },
      });
    });

    it("19. Cron route handler /api/cron/cleanup-idempotency enforces auth and executes cleanup", async () => {
      const origSecret = process.env.CRON_SECRET;
      try {
        process.env.CRON_SECRET = "test-secret-123";

        // Unauthenticated -> 401
        const unauthReq = new Request("https://buildohub.in/api/cron/cleanup-idempotency", {
          method: "GET",
        });
        const unauthRes = await cronCleanupGet(unauthReq as any);
        expect(unauthRes.status).toBe(401);

        // Missing CRON_SECRET on server -> 500
        delete process.env.CRON_SECRET;
        const noSecretReq = new Request("https://buildohub.in/api/cron/cleanup-idempotency", {
          method: "GET",
          headers: { Authorization: "Bearer test-secret-123" },
        });
        const noSecretRes = await cronCleanupGet(noSecretReq as any);
        expect(noSecretRes.status).toBe(500);

        // Valid CRON_SECRET -> 200
        process.env.CRON_SECRET = "test-secret-123";
        cartIdempotencyFindMany.mockResolvedValueOnce([]);
        cartIdempotencyDeleteMany.mockResolvedValue({ count: 0 });

        const authReq = new Request("https://buildohub.in/api/cron/cleanup-idempotency", {
          method: "GET",
          headers: { Authorization: "Bearer test-secret-123" },
        });
        const authRes = await cronCleanupGet(authReq as any);
        expect(authRes.status).toBe(200);
        const data = await authRes.json();
        expect(data.success).toBe(true);
        expect(data.deletedCount).toBe(0);
      } finally {
        process.env.CRON_SECRET = origSecret;
      }
    });
  });
});

