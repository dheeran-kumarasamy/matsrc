"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { builderApiGet, builderApiPost } from "@/lib/api";

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

type SupplierGroup = {
  supplierId: string;
  supplierName: string;
  items: CartResponse["items"];
  total: number;
};

export default function CheckoutPage() {
  const router = useRouter();
  const [deliveryDate, setDeliveryDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartResponse>({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });

  useEffect(() => {
    let active = true;

    async function loadCart() {
      try {
        const payload = await builderApiGet<CartResponse>("/builder/cart");
        if (!active) return;
        setCart(payload);
      } catch {
        if (!active) return;
        setCart({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });
      }
    }

    void loadCart();
    return () => {
      active = false;
    };
  }, []);

  const groupedItems = useMemo<SupplierGroup[]>(() => {
    const groups = new Map<string, SupplierGroup>();

    for (const item of cart.items) {
      const existing = groups.get(item.supplierId) ?? {
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        items: [],
        total: 0,
      };

      existing.items.push(item);
      existing.total += item.lineTotal;
      groups.set(item.supplierId, existing);
    }

    return Array.from(groups.values());
  }, [cart.items]);

  const gst = useMemo(() => Math.round(cart.summary.subtotal * 0.18), [cart.summary.subtotal]);
  const total = useMemo(() => cart.summary.subtotal + gst, [cart.summary.subtotal, gst]);

  async function handleSubmitEnquiry() {
    if (!cart.items.length) {
      setError("Your enquiry basket is empty.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await builderApiPost("/builder/orders/checkout", {
        deliveryDate: deliveryDate || undefined,
      });
      router.push("/orders");
    } catch {
      setError("Unable to submit enquiry right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Checkout</p>
        <h1 className="text-2xl font-bold text-slate-900">Submit supplier enquiries</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your cart will be split into separate enquiries per supplier. No payment is taken here.
        </p>
      </div>

      <div className="panel p-5">
        <h2 className="font-semibold text-slate-800 mb-3">1. Review by supplier</h2>
        <div className="space-y-4">
          {groupedItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
              No enquiry items found.
            </div>
          ) : (
            groupedItems.map((group) => (
              <div key={group.supplierId} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{group.supplierName}</p>
                    <p className="text-xs text-slate-400">{group.items.length} line item(s) will be sent as one enquiry</p>
                  </div>
                  <p className="text-sm font-bold text-slate-900">INR {group.total.toLocaleString("en-IN")}</p>
                </div>
                <div className="mt-3 space-y-2">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm text-slate-700">
                      <span>
                        {item.name} ({item.quantity} {item.unit})
                      </span>
                      <span className="font-semibold">INR {item.lineTotal.toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="font-semibold text-slate-800 mb-3">2. Preferred delivery date</h2>
        <p className="text-xs text-slate-400 mb-3">Optional. Applied to all supplier enquiries in this submission.</p>
        <input
          type="date"
          value={deliveryDate}
          onChange={(event) => setDeliveryDate(event.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="panel p-5 space-y-3">
        <div className="flex justify-between text-sm text-slate-500">
          <span>Subtotal</span>
          <span>INR {cart.summary.subtotal.toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-500">
          <span>GST estimate</span>
          <span>INR {gst.toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between border-t border-slate-100 pt-3 font-bold text-slate-800">
          <span>Estimated enquiry value</span>
          <span>INR {total.toLocaleString("en-IN")}</span>
        </div>
        <button
          onClick={handleSubmitEnquiry}
          disabled={loading || cart.items.length === 0}
          className="w-full rounded-lg bg-blue-700 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Submit Enquiry"}
        </button>
        {error ? <p className="text-center text-xs text-red-600">{error}</p> : null}
        <p className="text-center text-xs text-slate-400">
          Supplier confirmation will unlock payment links inside My Orders.
        </p>
      </div>
    </div>
  );
}
