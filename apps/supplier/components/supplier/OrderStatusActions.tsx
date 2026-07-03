"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";

const transitions = [
  { label: "Confirm Enquiry", status: "PROCESSING" },
  { label: "Decline Enquiry", status: "CANCELLED" },
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
            disabled={pending !== null || status === transition.status}
            onClick={() => updateStatus(transition.status)}
            className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
              transition.status === "CANCELLED"
                ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                : transition.status === "PROCESSING"
                ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {pending === transition.status ? "Updating..." : transition.label}
          </button>
        ))}
      </div>
    </aside>
  );
}