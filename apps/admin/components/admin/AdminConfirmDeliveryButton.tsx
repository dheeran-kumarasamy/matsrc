"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminConfirmDeliveryButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    const confirmed = window.confirm(
      "Are you sure you want to mark this order as DELIVERED on behalf of the buyer?\n\nThis override should only be used if the buyer/site engineer has confirmed physical receipt offline."
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/confirm-delivery`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to mark order as delivered.");
      }
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={handleConfirm}
        disabled={loading}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
        title="Admin Override: Mark this order as delivered on behalf of the buyer"
      >
        {loading ? "Marking Delivered..." : "Mark Delivered (Admin Override)"}
      </button>
      {error ? <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}

