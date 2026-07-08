"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PriceTier = { minQty: number; unitPrice: number };

type PoolSummary = {
  id: string;
  supplierId: string;
  productId: string;
  zoneKey: string;
  status: "OPEN" | "LOCKED" | "FULFILLING" | "CLOSED" | "CANCELLED";
  currentQuantity: number;
  priceTiers: PriceTier[];
  lockedUnitPrice: number | null;
  currentUnitPrice: number;
  nextTier: PriceTier | null;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  windowCloseAt: string;
  lockedAt: string | null;
};

type ParticipantSummary = {
  id: string;
  poolId: string;
  builderId: string;
  quantity: number;
  status: "PENDING" | "LOCKED_IN" | "CONVERTED" | "OPTED_OUT";
  orderId: string | null;
  optedInAt: string;
  optedOutAt: string | null;
};

type MyPoolParticipation = {
  participant: ParticipantSummary;
  pool: PoolSummary;
  productName: string;
  supplierName: string;
};

async function fetchMyPools(): Promise<MyPoolParticipation[]> {
  const response = await fetch("/api/builder/aggregation/my-pools", { cache: "no-store" });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function optOutOfPool(poolId: string): Promise<boolean> {
  const response = await fetch(`/api/builder/aggregation/pools/${poolId}/opt-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return response.ok;
}

function formatCountdown(windowCloseAt: string) {
  const diffMs = new Date(windowCloseAt).getTime() - Date.now();
  if (diffMs <= 0) return "Closing soon";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  return `${hours}h left`;
}

export default function GroupOrdersPage() {
  const [pools, setPools] = useState<MyPoolParticipation[]>([]);
  const [loading, setLoading] = useState(true);
  const [optOutLoadingId, setOptOutLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const data = await fetchMyPools();
      if (!active) return;
      setPools(data);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function handleOptOut(poolId: string) {
    setOptOutLoadingId(poolId);
    setError(null);
    const ok = await optOutOfPool(poolId);
    if (ok) {
      setPools((prev) => prev.filter((p) => p.pool.id !== poolId));
    } else {
      setError("Unable to opt out right now. Please try again.");
    }
    setOptOutLoadingId(null);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Order Tracking</p>
          <h1 className="text-2xl font-bold text-slate-900">My Group Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track your active Group &amp; Save pools, savings so far, and time left before prices lock.
          </p>
        </div>
        <Link href="/orders" className="text-xs font-semibold text-blue-700 hover:underline">
          ← Back to My Orders
        </Link>
      </div>

      {error ? <p className="text-center text-xs text-red-600">{error}</p> : null}

      {loading ? (
        <div className="panel p-10 text-center text-sm text-slate-400">Loading your group pools...</div>
      ) : pools.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-sm text-slate-400">You haven&apos;t joined any Group &amp; Save pools yet.</p>
          <Link href="/checkout" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Go to checkout to join a pool →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {pools.map(({ participant, pool, productName, supplierName }) => {
            const isLocked = pool.status === "LOCKED" || pool.status === "FULFILLING" || pool.status === "CLOSED";
            const savingsPerUnit = pool.priceTiers.length
              ? Math.max(0, pool.priceTiers[0].unitPrice - pool.currentUnitPrice)
              : 0;

            return (
              <div key={pool.id} className="panel p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{productName}</p>
                    <p className="text-xs text-slate-400">
                      {supplierName} · Zone {pool.zoneKey} · Qty joined: {participant.quantity}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      isLocked
                        ? "bg-blue-100 text-blue-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {isLocked ? "Price Locked" : "Pooling"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-400">Pool quantity</p>
                    <p className="font-semibold text-slate-800">{pool.currentQuantity}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Current price</p>
                    <p className="font-semibold text-slate-800">
                      INR {(pool.lockedUnitPrice ?? pool.currentUnitPrice).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Savings/unit</p>
                    <p className="font-semibold text-emerald-700">
                      {savingsPerUnit > 0 ? `INR ${savingsPerUnit.toLocaleString("en-IN")}` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">{isLocked ? "Locked at" : "Time left"}</p>
                    <p className="font-semibold text-slate-800">
                      {isLocked
                        ? pool.lockedAt
                          ? new Date(pool.lockedAt).toLocaleDateString("en-IN")
                          : "—"
                        : formatCountdown(pool.windowCloseAt)}
                    </p>
                  </div>
                </div>

                {pool.nextTier && !isLocked ? (
                  <p className="text-xs text-emerald-700">
                    {Math.max(0, pool.nextTier.minQty - pool.currentQuantity)} more unit(s) needed to unlock INR{" "}
                    {pool.nextTier.unitPrice.toLocaleString("en-IN")}/unit.
                  </p>
                ) : null}

                {isLocked ? (
                  <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    This pool has been locked and can no longer be modified. Your order will now proceed through
                    standard fulfilment.
                  </p>
                ) : (
                  <button
                    onClick={() => handleOptOut(pool.id)}
                    disabled={optOutLoadingId === pool.id}
                    className="w-full rounded-lg border border-rose-200 bg-white py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                  >
                    {optOutLoadingId === pool.id ? "Opting out..." : "Opt out of this pool"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
