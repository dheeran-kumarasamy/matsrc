"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { builderApiGet, builderApiPost } from "@/lib/api";
import { recordInterestEvent } from "@/lib/interest-events";

async function builderAggregationPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/builder/aggregation${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Aggregation request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

type PriceTier = { minQty: number; unitPrice: number };

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
    aggregationEnabled?: boolean;
    aggregationPriceTiers?: PriceTier[] | null;
    aggregationWindowDays?: number | null;
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

function nextTierFor(item: CartResponse["items"][number]) {
  const tiers = item.aggregationPriceTiers ?? [];
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const next = sorted.find((tier) => tier.minQty > item.quantity);
  return next ?? null;
}

function currentBestTier(item: CartResponse["items"][number]) {
  const tiers = item.aggregationPriceTiers ?? [];
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  return sorted[sorted.length - 1] ?? null;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [deliveryDate, setDeliveryDate] = useState("");
  const [pincode, setPincode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartResponse>({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });
  const [poolingItemIds, setPoolingItemIds] = useState<Set<string>>(new Set());
  const [optInLoadingId, setOptInLoadingId] = useState<string | null>(null);
  const [optInError, setOptInError] = useState<string | null>(null);
  const [optInSuccessId, setOptInSuccessId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCart() {
      try {
        const payload = await builderApiGet<CartResponse>("/cart");
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
      if (poolingItemIds.has(item.id)) continue;
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
  }, [cart.items, poolingItemIds]);

  const gst = useMemo(() => Math.round(cart.summary.subtotal * 0.18), [cart.summary.subtotal]);
  const total = useMemo(() => cart.summary.subtotal + gst, [cart.summary.subtotal, gst]);

  async function handleOptIn(item: CartResponse["items"][number]) {
    if (!pincode || pincode.length !== 6) {
      setOptInError("Enter a valid 6-digit delivery pincode before opting in to Group & Save.");
      return;
    }
    if (!deliveryDate) {
      setOptInError("Select a preferred delivery date before opting in to Group & Save.");
      return;
    }

    setOptInLoadingId(item.id);
    setOptInError(null);
    try {
      await builderAggregationPost("/opt-in", {
        supplierId: item.supplierId,
        productId: item.productId,
        zoneKey: pincode,
        requestedDeliveryDate: new Date(deliveryDate).toISOString(),
        quantity: item.quantity,
      });
      setPoolingItemIds((prev) => new Set(prev).add(item.id));
      setOptInSuccessId(item.id);
    } catch {
      setOptInError("Unable to join the Group & Save pool right now. Please try again.");
    } finally {
      setOptInLoadingId(null);
    }
  }

  async function handleSubmitEnquiry() {
    const remainingItems = cart.items.filter((item) => !poolingItemIds.has(item.id));
    if (!remainingItems.length) {
      setError("Your enquiry basket is empty.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const listingIds = Array.from(new Set(remainingItems.map((item) => item.productId)));
      await builderApiPost("/orders/checkout", {
        deliveryDate: deliveryDate || undefined,
      });
      await Promise.allSettled(listingIds.map((listingId) => recordInterestEvent(listingId, "ORDER_PLACED")));
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
          {groupedItems.length === 0 && poolingItemIds.size === 0 ? (
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
                <div className="mt-3 space-y-3">
                  {group.items.map((item) => {
                    const eligible = item.aggregationEnabled && (item.aggregationPriceTiers?.length ?? 0) > 0;
                    const next = eligible ? nextTierFor(item) : null;
                    const best = eligible ? currentBestTier(item) : null;
                    const savingsPerUnit = best ? Math.max(0, item.unitPrice - best.unitPrice) : 0;

                    return (
                      <div key={item.id}>
                        <div className="flex items-center justify-between text-sm text-slate-700">
                          <span>
                            {item.name} ({item.quantity} {item.unit})
                          </span>
                          <span className="font-semibold">INR {item.lineTotal.toLocaleString("en-IN")}</span>
                        </div>

                        {eligible ? (
                          <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-emerald-800">
                                Group &amp; Save available for this item
                              </p>
                              {savingsPerUnit > 0 ? (
                                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                  Save up to INR {savingsPerUnit.toLocaleString("en-IN")}/unit
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 overflow-hidden rounded-lg border border-emerald-100">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-emerald-100/70 text-emerald-800">
                                  <tr>
                                    <th className="px-2 py-1 font-medium">Min qty</th>
                                    <th className="px-2 py-1 font-medium">Unit price</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-emerald-100 bg-white/60">
                                  {(item.aggregationPriceTiers ?? [])
                                    .slice()
                                    .sort((a, b) => a.minQty - b.minQty)
                                    .map((tier) => (
                                      <tr key={tier.minQty}>
                                        <td className="px-2 py-1 text-slate-700">{tier.minQty}+</td>
                                        <td className="px-2 py-1 text-slate-700">
                                          INR {tier.unitPrice.toLocaleString("en-IN")}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                            {next ? (
                              <p className="mt-2 text-[11px] text-emerald-700">
                                Only {Math.max(0, next.minQty - item.quantity)} more unit(s) from other builders needed to unlock
                                INR {next.unitPrice.toLocaleString("en-IN")}/unit.
                              </p>
                            ) : (
                              <p className="mt-2 text-[11px] text-emerald-700">
                                You&apos;re eligible for the best available tier price.
                              </p>
                            )}

                            {optInSuccessId === item.id ? (
                              <p className="mt-2 text-[11px] font-medium text-emerald-800">
                                Joined! Track this pool under &quot;My Group Orders&quot;.
                              </p>
                            ) : (
                              <button
                                onClick={() => handleOptIn(item)}
                                disabled={optInLoadingId === item.id}
                                className="mt-3 w-full rounded-lg border border-emerald-600 bg-white py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-white disabled:opacity-50"
                              >
                                {optInLoadingId === item.id ? "Joining pool..." : "Wait & Save — Join Group Pool"}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {poolingItemIds.size > 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-800">
              {poolingItemIds.size} item(s) have joined a Group &amp; Save pool and will be tracked under{" "}
              <span className="font-semibold">My Group Orders</span> instead of this checkout.
            </div>
          ) : null}

          {optInError ? <p className="text-center text-xs text-red-600">{optInError}</p> : null}
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="font-semibold text-slate-800 mb-3">2. Preferred delivery date &amp; zone</h2>
        <p className="text-xs text-slate-400 mb-3">
          Optional for standard checkout, but required to join a Group &amp; Save pool.
        </p>
        <div className="flex flex-wrap gap-3">
          <input
            type="date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Delivery pincode"
            maxLength={6}
            value={pincode}
            onChange={(event) => setPincode(event.target.value.replace(/\D/g, ""))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
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
          disabled={loading || cart.items.filter((item) => !poolingItemIds.has(item.id)).length === 0}
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
