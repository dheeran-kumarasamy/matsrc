"use client";

import { useState } from "react";
import { ShoppingCart } from "lucide-react";

export default function AddToCartButton({ productId }: { productId: string }) {
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleAdd() {
    setLoading(true);
    await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity: 1 }),
    });
    setAdded(true);
    setLoading(false);
  }

  return (
    <button
      onClick={handleAdd}
      disabled={loading}
      className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${added ? "bg-green-500 text-white" : "bg-blue-700 hover:bg-blue-800 text-white"} disabled:opacity-50`}
    >
      <ShoppingCart size={16} />
      {added ? "Added to Cart ✓" : loading ? "Adding..." : "Add to Cart"}
    </button>
  );
}
