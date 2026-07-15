"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPost } from "@/lib/api-client";

export type AdminAggregationPool = {
  id: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  zoneKey: string;
  status: "OPEN" | "LOCKED" | "FULFILLING" | "CLOSED" | "CANCELLED";
  currentQuantity: number;
  participantCount: number;
  currentUnitPrice: number;
  lockedUnitPrice: number | null;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  windowCloseAt: string;
  lockedAt: string | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function statusBadgeClasses(status: AdminAggregationPool["status"]) {
  switch (status) {
    case "OPEN":
      return "bg-amber-50 text-amber-700";
    case "LOCKED":
      return "bg-emerald-50 text-emerald-700";
    case "FULFILLING":
      return "bg-blue-50 text-blue-700";
    case "CLOSED":
      return "bg-slate-100 text-slate-600";
    case "CANCELLED":
      return "bg-red-50 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function AggregationPoolsBoard({ pools }: { pools: AdminAggregationPool[] }) {
  const router = useRouter();
  const [activePoolId, setActivePoolId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openOverrideDialog(poolId: string) {
    setActivePoolId(poolId);
    setReason("");
    setError(null);
  }

  function closeOverrideDialog() {
    setActivePoolId(null);
    setReason("");
    setError(null);
  }

  async function submitOverrideClose(poolId: string) {
    if (!reason.trim()) {
      setError("A reason is required to override-close a pool.");
      return;
    }

    setSubmittingId(poolId);
    setError(null);
    try {
      await adminApiPost(`/admin/aggregation/pools/${poolId}/override-close`, { reason: reason.trim() });
      closeOverrideDialog();
      router.refresh();
    } catch {
      setError("Unable to override-close this pool right now.");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Aggregation Pools</h3>
      <p className="mt-1 text-sm text-slate-600">Monitor Group & Save pools across all suppliers and zones. Override-close requires a reason and is logged to the audit trail.</p>

      <div className="mt-3 space-y-3">
        {pools.length === 0 ? (
          <p className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">No aggregation pools match the current filters.</p>
        ) : (
          pools.map((pool) => (
            <article key={pool.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{pool.productName}</p>
                  <p className="text-sm text-slate-600">
                    Supplier: {pool.supplierName} · Zone: {pool.zoneKey}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusBadgeClasses(pool.status)}`}>
                  {pool.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-600 sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase text-slate-400">Quantity</p>
                  <p className="font-semibold text-slate-800">{pool.currentQuantity}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Participants</p>
                  <p className="font-semibold text-slate-800">{pool.participantCount}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Price</p>
                  <p className="font-semibold text-slate-800">
                    {formatCurrency(pool.lockedUnitPrice ?? pool.currentUnitPrice)}
                    {pool.lockedUnitPrice ? " (locked)" : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Window Closes</p>
                  <p className="font-semibold text-slate-800">{formatDate(pool.windowCloseAt)}</p>
                </div>
              </div>

              {pool.status === "OPEN" || pool.status === "LOCKED" || pool.status === "FULFILLING" ? (
                <div className="mt-3">
                  {activePoolId === pool.id ? (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-semibold text-slate-700">
                        Reason for override-close (required)
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="e.g. Supplier unable to fulfil at locked price"
                        />
                      </label>
                      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={submittingId === pool.id}
                          onClick={() => void submitOverrideClose(pool.id)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {submittingId === pool.id ? "Closing..." : "Confirm Override-Close"}
                        </button>
                        <button
                          type="button"
                          onClick={closeOverrideDialog}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openOverrideDialog(pool.id)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Override-Close
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
