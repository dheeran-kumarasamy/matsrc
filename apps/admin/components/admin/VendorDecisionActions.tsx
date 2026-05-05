"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPatch } from "@/lib/api";

export function VendorDecisionActions({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"APPROVED" | "REJECTED" | null>(null);

  async function updateVendor(status: "APPROVED" | "REJECTED") {
    setLoading(status);
    try {
      await adminApiPatch(`/admin/vendors/${vendorId}/kyc`, { status });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <button
        disabled={loading !== null}
        onClick={() => void updateVendor("APPROVED")}
        className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {loading === "APPROVED" ? "Approving..." : "Approve Vendor"}
      </button>
      <button
        disabled={loading !== null}
        onClick={() => void updateVendor("REJECTED")}
        className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {loading === "REJECTED" ? "Rejecting..." : "Reject Vendor"}
      </button>
      <button className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Request Clarification</button>
    </div>
  );
}
