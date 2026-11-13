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
  // C12 fix: the product's primary image URL (Product.images[0] — see
  // /api/builder/cart's GET handler), or null when the product has none.
  image?: string | null;
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
  summary: { itemCount: 0, subtotal: 0, subtotalLabel: "₹0" },
};

function recomputeSummary(items: CartItem[]): CartSummary {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    itemCount: items.length,
    subtotal,
    subtotalLabel: `₹${subtotal.toLocaleString("en-IN")}`,
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
  addItem: (productId: string, quantity: number, idempotencyKey?: string) => Promise<void>;
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

  async addItem(productId, quantity, idempotencyKey?: string) {
    set({ isMutating: true, error: null });
    // Stable operation-level key: reused on retry, fresh on new user action
    const key =
      idempotencyKey ||
      `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    try {
      // POST /cart/items returns the authoritative { items, summary } payload,
      // completely eliminating any redundant sequential GET /cart round-trip.
      // Mode "increment" ensures concurrent additions are additive and never overwrite.
      const response = await builderApiPost<CartResponse & { id: string }>("/cart/items", {
        productId,
        quantity,
        mode: "increment",
        idempotencyKey: key,
      });
      if (!response || !Array.isArray(response.items) || !response.summary) {
        throw new Error("malformed-cart-response");
      }
      set({ items: response.items, summary: response.summary, isMutating: false, hasLoaded: true });
    } catch (err: any) {
      const isConflict = err?.status === 409;
      const message =
        isConflict ||
        (err?.message &&
          !["Network failure", "malformed-cart-response", "fetch failed"].some((prefix) =>
            err.message.includes(prefix)
          ))
          ? err.message
          : "Unable to add this item to your enquiry basket.";

      if (isConflict && err?.data && Array.isArray(err.data.items) && err.data.summary) {
        set({
          items: err.data.items,
          summary: err.data.summary,
          isMutating: false,
          hasLoaded: true,
          error: message,
        });
      } else {
        set({ isMutating: false, error: message });
      }
      throw new Error("add-item-failed");
    }
  },

  async updateQuantity(productId, cartItemId, quantity) {
    // REQ-01: editable cart quantity. Reuses the existing cart upsert
    // endpoint (CartService.upsert on the API) which already recomputes
    // tiered pricing server-side — so we optimistically update the local
    // quantity for a snappy UI, then reconcile unitPrice/lineTotal against
    // the authoritative server response.
    // Mode "set" targets the existing item and fails with 409 Conflict if checked out.
    const safeQuantity = Math.max(1, Math.floor(quantity) || 1);
    const previousItems = get().items;
    const optimisticItems = previousItems.map((item) =>
      item.id === cartItemId
        ? { ...item, quantity: safeQuantity, lineTotal: item.unitPrice * safeQuantity }
        : item
    );
    set({ items: optimisticItems, summary: recomputeSummary(optimisticItems), isMutating: true, error: null });
    try {
      const response = await builderApiPost<CartResponse & { id: string }>("/cart/items", {
        productId,
        cartItemId,
        quantity: safeQuantity,
        mode: "set",
      });
      if (!response || !Array.isArray(response.items) || !response.summary) {
        throw new Error("malformed-cart-response");
      }
      set({ items: response.items, summary: response.summary, isMutating: false, hasLoaded: true });
    } catch (err: any) {
      const isConflict = err?.status === 409;
      const message =
        isConflict ||
        (err?.message &&
          !["Network failure", "malformed-cart-response", "fetch failed"].some((prefix) =>
            err.message.includes(prefix)
          ))
          ? err.message
          : "Unable to update quantity. Please try again.";

      if (isConflict) {
        // Section 2: On a checkout-related 409, synchronise Zustand with the authoritative current server cart.
        // Never restore a stale pre-request snapshot!
        if (err?.data && Array.isArray(err.data.items) && err.data.summary) {
          set({
            items: err.data.items,
            summary: err.data.summary,
            isMutating: false,
            hasLoaded: true,
            error: message,
          });
        } else {
          // Exceptional conflict-recovery operation
          try {
            const authoritative = await builderApiGet<CartResponse>("/cart");
            set({
              items: authoritative.items,
              summary: authoritative.summary,
              isMutating: false,
              hasLoaded: true,
              error: message,
            });
          } catch {
            set({ isMutating: false, error: message });
          }
        }
      } else {
        // Non-conflict failure (network drop, validation error, etc.) reverts optimistic update
        set({
          items: previousItems,
          summary: recomputeSummary(previousItems),
          isMutating: false,
          error: message,
        });
      }
      throw new Error("update-quantity-failed");
    }
  },

  async removeItem(productId, cartItemId) {

    const previousItems = get().items;
    // Optimistic removal for a snappy drawer experience.
    const nextItems = previousItems.filter((item) => item.id !== cartItemId);
    set({ items: nextItems, summary: recomputeSummary(nextItems), isMutating: true, error: null });
    try {
      const url = cartItemId
        ? `/cart/items/${productId}?cartItemId=${encodeURIComponent(cartItemId)}`
        : `/cart/items/${productId}`;
      await builderApiDelete(url);
      set({ isMutating: false });
    } catch {
      // Roll back on failure
      set({ items: previousItems, summary: recomputeSummary(previousItems), isMutating: false, error: "Unable to remove item. Please try again." });
    }
  },
}));
