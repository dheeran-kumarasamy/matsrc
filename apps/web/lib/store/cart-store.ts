import { create } from "zustand";
import { builderApiDelete, builderApiGet, builderApiPost } from "@/lib/api";

// Client-side mirror of the server cart (`/api/builder/cart`) with optimistic
// updates. This is what powers the persistent cart drawer / badge count so
// that adding an item from the quick-view overlay is reflected instantly
// everywhere (nav icon, drawer) without a full page reload — core to the
// single-page overlay ordering architecture (spec section 5A).

export type PriceTier = { minQty: number; unitPrice: number };

export type CartItem = {
  id: string;
  productId: string;
  name: string;
  unit: string;
  supplierId: string;
  supplierName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  aggregationEnabled?: boolean;
  aggregationPriceTiers?: PriceTier[] | null;
  aggregationWindowDays?: number | null;
};

type CartSummary = {
  itemCount: number;
  subtotal: number;
  subtotalLabel: string;
};

type CartResponse = {
  items: CartItem[];
  summary: CartSummary;
};

const EMPTY_CART: CartResponse = {
  items: [],
  summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" },
};

function recomputeSummary(items: CartItem[]): CartSummary {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    itemCount: items.length,
    subtotal,
    subtotalLabel: `INR ${subtotal.toLocaleString("en-IN")}`,
  };
}

interface CartState {
  items: CartItem[];
  summary: CartSummary;
  hasLoaded: boolean;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;

  fetchCart: () => Promise<void>;
  addItem: (productId: string, quantity: number) => Promise<void>;
  updateQuantity: (productId: string, cartItemId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string, cartItemId: string) => Promise<void>;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: EMPTY_CART.items,
  summary: EMPTY_CART.summary,
  hasLoaded: false,
  isLoading: false,
  isMutating: false,
  error: null,

  async fetchCart() {
    set({ isLoading: true, error: null });
    try {
      const payload = await builderApiGet<CartResponse>("/cart");
      set({ items: payload.items, summary: payload.summary, hasLoaded: true, isLoading: false });
    } catch {
      set({ isLoading: false, hasLoaded: true, error: "Unable to load your cart right now." });
    }
  },

  async addItem(productId, quantity) {
    set({ isMutating: true, error: null });
    try {
      await builderApiPost("/cart/items", { productId, quantity });
      // Server is the source of truth for pricing tiers, so re-fetch rather
      // than optimistically guessing the unit price.
      const payload = await builderApiGet<CartResponse>("/cart");
      set({ items: payload.items, summary: payload.summary, isMutating: false, hasLoaded: true });
    } catch {
      set({ isMutating: false, error: "Unable to add this item to your enquiry basket." });
      throw new Error("add-item-failed");
    }
  },

  async updateQuantity(productId, cartItemId, quantity) {
    // REQ-01: editable cart quantity. Reuses the existing cart upsert
    // endpoint (CartService.upsert on the API) which already recomputes
    // tiered pricing server-side — so we optimistically update the local
    // quantity for a snappy UI, then re-fetch to reconcile unitPrice/
    // lineTotal against the server (source of truth for pricing tiers).
    const safeQuantity = Math.max(1, Math.floor(quantity) || 1);
    const previousItems = get().items;
    const optimisticItems = previousItems.map((item) =>
      item.id === cartItemId
        ? { ...item, quantity: safeQuantity, lineTotal: item.unitPrice * safeQuantity }
        : item
    );
    set({ items: optimisticItems, summary: recomputeSummary(optimisticItems), isMutating: true, error: null });
    try {
      await builderApiPost("/cart/items", { productId, quantity: safeQuantity });
      const payload = await builderApiGet<CartResponse>("/cart");
      set({ items: payload.items, summary: payload.summary, isMutating: false, hasLoaded: true });
    } catch {
      set({
        items: previousItems,
        summary: recomputeSummary(previousItems),
        isMutating: false,
        error: "Unable to update quantity. Please try again.",
      });
      throw new Error("update-quantity-failed");
    }
  },

  async removeItem(productId, cartItemId) {

    const previousItems = get().items;
    // Optimistic removal for a snappy drawer experience.
    const nextItems = previousItems.filter((item) => item.id !== cartItemId);
    set({ items: nextItems, summary: recomputeSummary(nextItems), isMutating: true, error: null });
    try {
      await builderApiDelete(`/cart/items/${productId}`);
      set({ isMutating: false });
    } catch {
      // Roll back on failure
      set({ items: previousItems, summary: recomputeSummary(previousItems), isMutating: false, error: "Unable to remove item. Please try again." });
    }
  },
}));
