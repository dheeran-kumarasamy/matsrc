"use client";

import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { useCartStore } from "@/lib/store/cart-store";
import { useOverlayStore } from "@/lib/store/overlay-store";

export default function AddToCartButton({ productId }: { productId: string }) {
  const addItem = useCartStore((state) => state.addItem);
  const openCart = useOverlayStore((state) => state.openCart);
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (added) {
      // Keep the PLP mounted underneath — open the persistent cart drawer
      // instead of navigating away (spec section 5A).
      openCart("review");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await addItem(productId, 1);
      setAdded(true);
    } catch {
      setError("Unable to add item to cart.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => void handleAdd()}
        disabled={loading}
        className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${added ? "bg-green-500 text-white" : "bg-blue-700 hover:bg-blue-800 text-white"} disabled:opacity-50`}
      >
        <ShoppingCart size={16} />
        {added ? "Added to Cart ✓" : loading ? "Adding..." : "Add to Cart"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
