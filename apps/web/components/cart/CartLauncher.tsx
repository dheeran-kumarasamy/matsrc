"use client";

// Persistent cart icon + item-count badge, mounted once in the Builder
// layout header so it's always visible regardless of which page/overlay is
// showing. Clicking it opens the cart Sheet (spec section 5A).

import { useEffect } from "react";
import { ShoppingCart } from "lucide-react";
import { useCartStore } from "@/lib/store/cart-store";
import { useOverlayStore } from "@/lib/store/overlay-store";

export default function CartLauncher() {
  const itemCount = useCartStore((state) => state.summary.itemCount);
  const hasLoaded = useCartStore((state) => state.hasLoaded);
  const fetchCart = useCartStore((state) => state.fetchCart);
  const openCart = useOverlayStore((state) => state.openCart);

  useEffect(() => {
    if (!hasLoaded) {
      void fetchCart();
    }
  }, [hasLoaded, fetchCart]);

  return (
    <button
      type="button"
      onClick={() => openCart("review")}
      className="relative flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-blue-700 hover:text-blue-700"
      aria-label="Open cart"
    >
      <ShoppingCart size={16} />
      <span className="hidden sm:inline">Cart</span>
      {itemCount > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-700 px-1 text-[11px] font-bold text-white">
          {itemCount}
        </span>
      ) : null}
    </button>
  );
}
