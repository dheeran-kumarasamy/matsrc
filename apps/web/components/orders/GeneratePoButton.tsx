"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { builderApiPost } from "@/lib/api";

// Trigger point: PO creation becomes available once a supplier has responded to an
// enquiry/RFQ with a confirmed quote (order.quoteSelectionCompletedAt is set server-side).
// Reuses accepted enquiry data — no manual re-entry required.
export default function GeneratePoButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const po = await builderApiPost<{ id: string }>("/purchase-orders", { orderId });
      router.push(`/purchase-orders/${po.id}`);
    } catch {
      setError("Could not generate a Purchase Order for this enquiry yet.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={generate}
        disabled={loading}
        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {loading ? "Generating..." : "Generate Purchase Order"}
      </button>
      <p className="text-xs text-slate-500">
        Auto-fills PO details from this accepted enquiry. Review, adjust and digitally approve in-app — no
        printing or manual signature required.
      </p>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
