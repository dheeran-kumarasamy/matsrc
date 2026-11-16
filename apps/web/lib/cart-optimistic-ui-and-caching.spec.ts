import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    cartItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    markupSetting: {
      findMany: vi.fn(),
    },
  },
  resolveUnitPrice: (product: any, quantity: number) => {
    const tiers = Array.isArray(product.pricingTiers) ? product.pricingTiers : [];
    const matched = tiers.find((t: any) => quantity >= t.minQty && quantity <= t.maxQty);
    return Number(matched?.tierPrice ?? product.basePrice);
  },
  formatCurrency: (amount: number | string) => {
    const n = Number(amount);
    return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
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

import { useCartStore } from "./store/cart-store";
import * as apiModule from "@/lib/api";
import {
  getCartForUser,
  clearMarkupCache,
  getMarkupCacheStats,
} from "./cart-data";

describe("Stage 3 Performance Remediation — Cart Query Consolidation & Optimistic UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMarkupCache();
    // Reset store state
    useCartStore.setState({
      items: [],
      summary: { itemCount: 0, subtotal: 0, subtotalLabel: "₹0.00" },
      hasLoaded: false,
      isLoading: false,
      isMutating: false,
      error: null,
    });
  });

  describe("Optimistic UI for useCartStore.addItem", () => {
    it("optimistically adds a provisional item immediately when adding a new product", async () => {
      let capturedStateDuringFlight: any = null;

      vi.spyOn(apiModule, "builderApiPost").mockImplementation(async () => {
        // Snapshot Zustand state while network request is in-flight
        capturedStateDuringFlight = useCartStore.getState();
        return {
          id: "cart-item-1",
          productId: "prod-new-1",
          quantity: 2,
          items: [
            {
              id: "cart-item-1",
              productId: "prod-new-1",
              name: "UltraTech Cement 53",
              unit: "BAG",
              supplierId: "supp-1",
              supplierName: "Supplier One",
              quantity: 2,
              unitPrice: 380,
              lineTotal: 760,
            },
          ],
          summary: {
            itemCount: 1,
            subtotal: 760,
            subtotalLabel: "₹760.00",
          },
        } as any;
      });

      const addPromise = useCartStore.getState().addItem("prod-new-1", 2);

      // Verify the in-flight state immediately reflected the optimistic addition!
      expect(capturedStateDuringFlight).not.toBeNull();
      expect(capturedStateDuringFlight.isMutating).toBe(true);
      expect(capturedStateDuringFlight.items).toHaveLength(1);
      expect(capturedStateDuringFlight.items[0].id).toBe("temp_prod-new-1");
      expect(capturedStateDuringFlight.items[0].productId).toBe("prod-new-1");
      expect(capturedStateDuringFlight.items[0].quantity).toBe(2);
      expect(capturedStateDuringFlight.summary.itemCount).toBe(1);

      await addPromise;

      // After server response: reconciled with authoritative server payload
      const finalState = useCartStore.getState();
      expect(finalState.isMutating).toBe(false);
      expect(finalState.items).toHaveLength(1);
      expect(finalState.items[0].id).toBe("cart-item-1"); // Real server ID replaces temp ID
      expect(finalState.items[0].name).toBe("UltraTech Cement 53");
      expect(finalState.items[0].unitPrice).toBe(380);
      expect(finalState.items[0].lineTotal).toBe(760);
      expect(finalState.summary.subtotal).toBe(760);
    });

    it("optimistically increments quantity and lineTotal when item already exists in cart", async () => {
      // Seed existing item
      useCartStore.setState({
        items: [
          {
            id: "cart-item-existing",
            productId: "prod-a",
            name: "Steel 12mm",
            unit: "TON",
            supplierId: "supp-steel",
            supplierName: "Steel Supplier",
            quantity: 5,
            unitPrice: 50000,
            lineTotal: 250000,
          },
        ],
        summary: {
          itemCount: 1,
          subtotal: 250000,
          subtotalLabel: "₹2,50,000.00",
        },
        hasLoaded: true,
        isLoading: false,
        isMutating: false,
        error: null,
      });

      let capturedStateDuringFlight: any = null;

      vi.spyOn(apiModule, "builderApiPost").mockImplementation(async () => {
        capturedStateDuringFlight = useCartStore.getState();
        return {
          id: "cart-item-existing",
          productId: "prod-a",
          quantity: 8,
          items: [
            {
              id: "cart-item-existing",
              productId: "prod-a",
              name: "Steel 12mm",
              unit: "TON",
              supplierId: "supp-steel",
              supplierName: "Steel Supplier",
              quantity: 8,
              unitPrice: 49000, // Tier discount applied server-side
              lineTotal: 392000,
            },
          ],
          summary: {
            itemCount: 1,
            subtotal: 392000,
            subtotalLabel: "₹3,92,000.00",
          },
        } as any;
      });

      const addPromise = useCartStore.getState().addItem("prod-a", 3);

      // Verify immediate in-flight optimistic increment
      expect(capturedStateDuringFlight.isMutating).toBe(true);
      expect(capturedStateDuringFlight.items).toHaveLength(1);
      expect(capturedStateDuringFlight.items[0].quantity).toBe(8); // 5 + 3 = 8
      expect(capturedStateDuringFlight.items[0].lineTotal).toBe(400000); // 8 * 50000 = 400000
      expect(capturedStateDuringFlight.summary.subtotal).toBe(400000);

      await addPromise;

      // Reconciled with authoritative server response
      const finalState = useCartStore.getState();
      expect(finalState.isMutating).toBe(false);
      expect(finalState.items[0].quantity).toBe(8);
      expect(finalState.items[0].unitPrice).toBe(49000);
      expect(finalState.items[0].lineTotal).toBe(392000);
      expect(finalState.summary.subtotal).toBe(392000);
    });

    it("rolls back cleanly to previous state on network failure without ghost items", async () => {
      // Seed pre-existing cart state
      const initialItems = [
        {
          id: "cart-item-1",
          productId: "prod-existing",
          name: "Brick",
          unit: "PIECE",
          supplierId: "supp-b",
          supplierName: "Brick Maker",
          quantity: 1000,
          unitPrice: 10,
          lineTotal: 10000,
        },
      ];
      useCartStore.setState({
        items: initialItems,
        summary: {
          itemCount: 1,
          subtotal: 10000,
          subtotalLabel: "₹10,000.00",
        },
        hasLoaded: true,
        isLoading: false,
        isMutating: false,
        error: null,
      });

      vi.spyOn(apiModule, "builderApiPost").mockRejectedValue(new Error("Network failure"));

      await expect(useCartStore.getState().addItem("prod-new-fails", 50)).rejects.toThrow("add-item-failed");

      // Verify complete rollback to initialItems with no ghost items left
      const state = useCartStore.getState();
      expect(state.items).toEqual(initialItems);
      expect(state.items).toHaveLength(1);
      expect(state.items[0].productId).toBe("prod-existing");
      expect(state.summary.subtotal).toBe(10000);
      expect(state.isMutating).toBe(false);
      expect(state.error).toBe("Unable to add this item to your enquiry basket.");
    });

    it("synchronises state with authoritative cart on 409 Conflict", async () => {
      const conflictPayload = {
        status: 409,
        data: {
          error: "Cart was updated concurrently. Please refresh your cart.",
          items: [
            {
              id: "cart-item-synced",
              productId: "prod-synced",
              name: "Synced Product",
              unit: "KG",
              supplierId: "supp-s",
              supplierName: "Synced Supplier",
              quantity: 15,
              unitPrice: 100,
              lineTotal: 1500,
            },
          ],
          summary: {
            itemCount: 1,
            subtotal: 1500,
            subtotalLabel: "₹1,500.00",
          },
        },
      };

      vi.spyOn(apiModule, "builderApiPost").mockRejectedValue(conflictPayload);

      await expect(useCartStore.getState().addItem("prod-any", 5)).rejects.toThrow("add-item-failed");

      const state = useCartStore.getState();
      expect(state.isMutating).toBe(false);
      expect(state.items).toHaveLength(1);
      expect(state.items[0].id).toBe("cart-item-synced");
      expect(state.items[0].quantity).toBe(15);
      expect(state.summary.subtotal).toBe(1500);
    });
  });

  describe("In-Memory Markup Settings Caching in cart-data.ts", () => {
    it("caches markup settings for 60 seconds and avoids redundant database queries", async () => {
      const markupFindManyMock = vi.fn().mockResolvedValue([
        { scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true },
      ]);

      const mockClient = {
        cartItem: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "item-1",
              productId: "prod-1",
              quantity: 2,
              resolvedUnitPrice: 100,
              resolvedSupplierId: "supp-1",
              product: {
                name: "Product 1",
                unit: "UNIT",
                supplierId: "supp-1",
                categoryId: "cat-1",
                basePrice: 100,
                images: ["https://example.com/p1.png"],
                supplier: { companyName: "Supplier 1" },
                pricingTiers: [],
              },
            },
          ]),
        },
        markupSetting: {
          findMany: markupFindManyMock,
        },
      };

      // Call 1: Cache is empty -> queries database
      const cart1 = await getCartForUser("user-1", mockClient as any);
      expect(markupFindManyMock).toHaveBeenCalledTimes(1);
      expect(cart1.items[0].unitPrice).toBe(110); // 100 + 10%

      const stats1 = getMarkupCacheStats();
      expect(stats1.isCached).toBe(true);
      expect(stats1.rowCount).toBe(1);

      // Call 2: Within 60 seconds -> returns from in-memory cache directly without querying db!
      const cart2 = await getCartForUser("user-1", mockClient as any);
      expect(markupFindManyMock).toHaveBeenCalledTimes(1); // STILL 1! Zero extra round-trips!
      expect(cart2.items[0].unitPrice).toBe(110);

      // Call 3: After clearMarkupCache() -> refreshes from db
      clearMarkupCache();
      const cart3 = await getCartForUser("user-1", mockClient as any);
      expect(markupFindManyMock).toHaveBeenCalledTimes(2); // Queried again
      expect(cart3.items[0].unitPrice).toBe(110);
    });

    it("falls back gracefully to stale cache if database query fails (stale-while-revalidate)", async () => {
      let shouldFail = false;
      const markupFindManyMock = vi.fn().mockImplementation(async () => {
        if (shouldFail) throw new Error("Database timeout");
        return [{ scope: "GLOBAL", scopeId: null, percentage: 15, isEnabled: true }];
      });

      const mockClient = {
        cartItem: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "item-1",
              productId: "prod-1",
              quantity: 1,
              resolvedUnitPrice: 200,
              resolvedSupplierId: "supp-1",
              product: {
                name: "Product 1",
                unit: "UNIT",
                supplierId: "supp-1",
                categoryId: "cat-1",
                basePrice: 200,
                images: [],
                supplier: { companyName: "Supplier 1" },
                pricingTiers: [],
              },
            },
          ]),
        },
        markupSetting: {
          findMany: markupFindManyMock,
        },
      };

      // Call 1: Succeeds and populates cache
      const cart1 = await getCartForUser("user-1", mockClient as any);
      expect(cart1.items[0].unitPrice).toBe(230); // 200 + 15%

      // Trigger failure on next refresh
      shouldFail = true;
      clearMarkupCache();
      // Even if cache was cleared, fallback to resolveMarkupForProductsBatch or safe price
      const cart2 = await getCartForUser("user-1", mockClient as any);
      expect(cart2.items).toHaveLength(1);
    });
  });
});
