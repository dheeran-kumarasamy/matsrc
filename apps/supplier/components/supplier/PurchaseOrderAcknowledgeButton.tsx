"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PurchaseOrderAcknowledgeButton({ poId, status }: { poId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setPending(true);
    setError(null);
    try {
      await axios.post(`/api/supplier/purchase-orders/${poId}/acknowledge`);
      router.refresh();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to acknowledge purchase order");
    } finally {
      setPending(false);
    }
  }

  if (status !== "ISSUED") {
    return (
      <p className="text-sm text-slate-500">
        {status === "ACKNOWLEDGED" ? "You have acknowledged this purchase order." : "Awaiting builder issuance."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={acknowledge}
        disabled={pending}
        className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
      >
        {pending ? "Acknowledging..." : "Acknowledge Purchase Order"}
      </button>
      <p className="text-xs text-slate-500">
        Acknowledging confirms receipt entirely in-app — no signature, print, or upload required.
      </p>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
