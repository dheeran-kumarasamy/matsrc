"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { builderApiDelete, builderApiGet, builderApiPost } from "@/lib/api";

type CartResponse = {
  items: Array<{
    id: string;
    productId: string;
    name: string;
    unit: string;
    supplierId: string;
    supplierName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  summary: {
    itemCount: number;
    subtotal: number;
    subtotalLabel: string;
  };
};

// UF-02 Step 8–9, UF-03 Step 1 — FR-09
export default function CartPage() {
  const router = useRouter();
  const [data, setData] = useState<CartResponse>({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCart() {
      try {
        const payload = await builderApiGet<CartResponse>("/cart");
        if (!active) return;
        setData(payload);
      } catch {
        if (!active) return;
        setData({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });
      }
    }

    void loadCart();
    return () => {
      active = false;
    };
  }, []);

  const gst = useMemo(() => Math.round(data.summary.subtotal * 0.18), [data.summary.subtotal]);
  const total = useMemo(() => data.summary.subtotal + gst, [data.summary.subtotal, gst]);

  async function handleRemove(productId: string, id: string) {
    setLoadingId(id);
    try {
      await builderApiDelete(`/cart/items/${productId}`);
      setData((prev) => {
        const items = prev.items.filter((item) => item.id !== id);
        const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
        return {
          items,
          summary: {
            itemCount: items.length,
            subtotal,
            subtotalLabel: `INR ${subtotal.toLocaleString("en-IN")}`,
          },
        };
      });
    } finally {
      setLoadingId(null);
    }
  }

  async function handleSubmitEnquiry() {
    if (data.items.length === 0) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await builderApiPost("/orders/checkout", {});
      router.push("/orders");
      router.refresh();
    } catch {
      setSubmitError("Unable to submit enquiry right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">My Cart</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Cart items */}
        <div className="flex-1 space-y-3">
          {data.items.length === 0 ? (
            <div className="panel p-10 text-center">
              <p className="text-slate-400 text-sm">Your cart is empty.</p>
              <Link href="/products" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
                Browse materials →
              </Link>
            </div>
          ) : (
            data.items.map((item) => (
              <div key={item.id} className="panel p-4 flex gap-4">
                <div className="w-16 h-16 bg-slate-100 rounded-lg shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-slate-800 text-sm">{item.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Supplier: {item.supplierName}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Qty: {item.quantity} {item.unit}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Unit price: INR {item.unitPrice.toLocaleString("en-IN")}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-sm font-semibold text-slate-800">INR {item.lineTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
                <button
                  disabled={loadingId === item.id}
                  onClick={() => void handleRemove(item.productId, item.id)}
                  className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Order summary */}
        <div className="w-full lg:w-80 shrink-0">
          <div className="panel p-5 sticky top-20 space-y-4">
            <h2 className="font-semibold text-slate-800">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span><span>INR {data.summary.subtotal.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>GST (18%)</span><span>INR {gst.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Freight</span><span>—</span>
              </div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-slate-800">
                <span>Total</span><span>INR {total.toLocaleString("en-IN")}</span>
              </div>
            </div>
            <button
              onClick={() => void handleSubmitEnquiry()}
              disabled={data.items.length === 0 || submitting}
              className="block w-full rounded-lg bg-blue-700 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Enquiry"}
            </button>
            <Link
              href="/checkout"
              className="block w-full text-center text-xs text-slate-500 hover:text-slate-700 hover:underline"
            >
              Review on checkout page
            </Link>
            {submitError ? <p className="text-xs text-red-600">{submitError}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
