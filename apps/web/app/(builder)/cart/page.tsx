"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";

// UF-02 Step 8–9, UF-03 Step 1 — FR-09
export default function CartPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">My Cart</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Cart items */}
        <div className="flex-1 space-y-3">
          {/* Empty state */}
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-gray-400 text-sm">Your cart is empty.</p>
            <Link href="/products" className="mt-3 inline-block text-sm text-brand-500 hover:underline">
              Browse materials →
            </Link>
          </div>

          {/* Example cart item — rendered from state in production */}
          {/* 
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex gap-4">
            <div className="w-16 h-16 bg-gray-100 rounded-lg shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-gray-800 text-sm">TMT Bar Fe-500D</p>
              <p className="text-xs text-gray-400 mt-0.5">Supplier: Raipur Steel Co.</p>
              <div className="flex items-center gap-3 mt-2">
                <input type="number" min={1} defaultValue={2} className="w-16 border border-gray-200 rounded px-2 py-1 text-xs" />
                <span className="text-sm font-semibold text-gray-800">₹1,24,800</span>
              </div>
            </div>
            <button className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
          </div>
          */}
        </div>

        {/* Order summary */}
        <div className="w-full lg:w-80 shrink-0">
          <div className="bg-white rounded-xl border border-gray-100 p-5 sticky top-20 space-y-4">
            <h2 className="font-semibold text-gray-800">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span><span>₹0</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>GST (18%)</span><span>₹0</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Freight</span><span>—</span>
              </div>
              <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-gray-800">
                <span>Total</span><span>₹0</span>
              </div>
            </div>
            <Link
              href="/checkout"
              className="block w-full text-center bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              Proceed to Checkout
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
