"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  getAvailableActions,
  getReadOnlyStatusLabel,
  type OrderStatus,
} from "@/lib/order-status-transitions";

// Visual treatment per action, keyed by the target status the action moves
// the order *to* (not the current status) — kept separate from the
// action/transition table itself (lib/order-status-transitions.ts) so that
// shared table stays framework-agnostic and reusable server-side.
const ACTION_STYLES: Record<string, string> = {
  CANCELLED: "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100",
  PROCESSING: "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100",
};
const DEFAULT_ACTION_STYLE = "border-slate-300 text-slate-700 hover:bg-slate-50";

export function OrderStatusActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(nextStatus: OrderStatus) {
    setPending(nextStatus);
    setError(null);
    try {
      await axios.patch(`/api/supplier/orders/${orderId}`, { status: nextStatus });
      router.refresh();
    } catch (err: any) {
      // Backend re-validates every transition (see updateSupplierOrderStatus
      // in lib/supplier-data.ts) and rejects anything not valid for the
      // order's *current* status with a 400 — surface that message rather
      // than silently failing, e.g. if this page's data is stale.
      setError(err?.response?.data?.message ?? "Unable to update order status right now.");
    } finally {
      setPending(null);
    }
  }

  // Only the action(s) valid for the order's *current* status are ever
  // rendered — never a fixed list of all four possible actions. See
  // lib/order-status-transitions.ts for the underlying state machine.
  const actions = getAvailableActions(status);
  const readOnlyLabel = getReadOnlyStatusLabel(status);

  return (
    <aside className="panel p-5">
      <h4 className="text-lg font-bold text-slate-900">Update Status</h4>
      <p className="mt-1 text-sm text-slate-600">Current status: {status}</p>

      {error ? <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p> : null}

      {actions.length > 0 ? (
        <div className="mt-3 space-y-2">
          {actions.map((action) => (
            <button
              key={action.key}
              disabled={pending !== null}
              onClick={() => updateStatus(action.nextStatus)}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                ACTION_STYLES[action.nextStatus] ?? DEFAULT_ACTION_STYLE
              }`}
            >
              {pending === action.nextStatus ? "Updating..." : action.label}
            </button>
          ))}
        </div>
      ) : (
        // Terminal state (Delivered/Cancelled) or an order status this table
        // doesn't recognise — never expose a possibly-invalid action, just
        // communicate that no further supplier action is required/possible.
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
          {readOnlyLabel ?? "No further action required"}
        </p>
      )}
    </aside>
  );
}
