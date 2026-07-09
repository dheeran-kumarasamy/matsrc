"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SupplierAggregationPool } from "@/lib/supplier-data";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusBadgeClasses(status: SupplierAggregationPool["status"]) {
  switch (status) {
    case "OPEN":
      return "bg-amber-100 text-amber-700";
    case "LOCKED":
      return "bg-emerald-100 text-emerald-700";
    case "FULFILLING":
      return "bg-blue-100 text-blue-700";
    case "CLOSED":
      return "bg-slate-200 text-slate-600";
    case "CANCELLED":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-slate-200 text-slate-600";
  }
}

export function AggregationPoolsWidget({ pools }: { pools: SupplierAggregationPool[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleForceLock(poolId: string) {
    setPendingId(poolId);
    try {
      await axios.post(`/api/supplier/aggregation/pools/${poolId}/force-lock`);
      router.refresh();
    } catch {
      // no-op — surfaced errors will be visible on refresh via unchanged state
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-7 py-5">
        <h3 className="text-4xl font-extrabold text-slate-900">Active Aggregation Pools</h3>
        <p className="mt-1 text-lg text-slate-600">Group & Save pools currently open or fulfilling for your listings.</p>
      </div>

      {pools.length === 0 ? (
        <p className="px-7 py-10 text-xl text-slate-500">No active aggregation pools right now.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {pools.map((pool) => {
            const maxTier = pool.priceTiers.length > 0 ? pool.priceTiers[pool.priceTiers.length - 1] : null;
            const progressPercent =
              maxTier && maxTier.minQty > 0 ? Math.min(100, Math.round((pool.currentQuantity / maxTier.minQty) * 100)) : 0;
            const canForceLock = pool.status === "OPEN";

            return (
              <div key={pool.id} className="px-7 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xl font-bold text-slate-900">{pool.productName}</p>
                    <p className="text-sm text-slate-500">Zone: {pool.zoneKey}</p>
                  </div>
                  <span className={`rounded-full px-4 py-1 text-base font-semibold ${statusBadgeClasses(pool.status)}`}>
                    {pool.status}
                  </span>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase text-slate-500">Quantity</p>
                    <p className="text-lg font-semibold text-slate-800">
                      {pool.currentQuantity}
                      {maxTier ? ` / ${maxTier.minQty}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-slate-500">Participants</p>
                    <p className="text-lg font-semibold text-slate-800">{pool.participantCount}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-slate-500">Revenue (current tier)</p>
                    <p className="text-lg font-semibold text-slate-800">{formatCurrency(pool.projectedRevenueAtCurrentTier)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-slate-500">Revenue (max tier)</p>
                    <p className="text-lg font-semibold text-slate-800">{formatCurrency(pool.projectedRevenueAtMaxTier)}</p>
                  </div>
                </div>

                {maxTier ? (
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                ) : null}

                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!canForceLock || pendingId === pool.id}
                    onClick={() => handleForceLock(pool.id)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingId === pool.id ? "Locking..." : "Force Lock Pool"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
