"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPatch } from "@/lib/api-client";

type KycItem = {
  id: string;
  vendor: string;
  document: string;
  submittedAt: string;
  status: "PENDING" | "FLAGGED";
};

export function KycReviewList({ items }: { items: KycItem[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function reviewKyc(documentId: string, verified: boolean) {
    setLoadingId(documentId);
    try {
      await adminApiPatch(`/admin/kyc/${documentId}`, { verified });
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">KYC Review Queue</h3>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">{item.vendor}</p>
                <p className="text-sm text-slate-600">{item.document}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.status === "FLAGGED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                {item.status}
              </span>
            </div>
            <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">Submitted {item.submittedAt}</p>
            <div className="mt-3 flex gap-2">
              <button
                disabled={loadingId === item.id}
                onClick={() => void reviewKyc(item.id, true)}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={loadingId === item.id}
                onClick={() => void reviewKyc(item.id, false)}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                Reject
              </button>
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Escalate</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}