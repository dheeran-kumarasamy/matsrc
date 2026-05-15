"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";

const transitions = [
  { label: "Confirm Enquiry", status: "PROCESSING" },
  { label: "Mark Dispatched", status: "DISPATCHED" },
  { label: "Mark Delivered", status: "DELIVERED" },
];

export function OrderStatusActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function updateStatus(nextStatus: string) {
    setPending(nextStatus);
    try {
      await axios.patch(`/api/supplier/orders/${orderId}`, { status: nextStatus });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <aside className="panel p-5">
      <h4 className="text-lg font-bold text-slate-900">Update Status</h4>
      <p className="mt-1 text-sm text-slate-600">Current status: {status}</p>
      <div className="mt-3 space-y-2">
        {transitions.map((transition) => (
          <button
            key={transition.status}
            disabled={pending !== null}
            onClick={() => updateStatus(transition.status)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {pending === transition.status ? "Updating..." : transition.label}
          </button>
        ))}
      </div>
    </aside>
  );
}