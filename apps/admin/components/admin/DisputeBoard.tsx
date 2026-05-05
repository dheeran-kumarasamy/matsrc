"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPatch } from "@/lib/api";

type Dispute = {
  id: string;
  orderId: string;
  issue: string;
  owner: string;
  sla: string;
  severity: "MEDIUM" | "HIGH";
};

export function DisputeBoard({ disputes }: { disputes: Dispute[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function updateDispute(id: string, status: "UNDER_REVIEW" | "RESOLVED" | "ESCALATED") {
    setLoadingId(id);
    try {
      await adminApiPatch(`/admin/disputes/${id}`, { status });
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Open Disputes</h3>
      <div className="mt-3 space-y-3">
        {disputes.map((dispute) => (
          <article key={dispute.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Dispute #{dispute.id}</p>
                <p className="text-sm text-slate-600">Order #{dispute.orderId} · {dispute.issue}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${dispute.severity === "HIGH" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                {dispute.severity}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
              <span>Owner: {dispute.owner}</span>
              <span>SLA: {dispute.sla}</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                disabled={loadingId === dispute.id}
                onClick={() => void updateDispute(dispute.id, "UNDER_REVIEW")}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                Mark In Review
              </button>
              <button
                disabled={loadingId === dispute.id}
                onClick={() => void updateDispute(dispute.id, "RESOLVED")}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Resolve
              </button>
              <button
                disabled={loadingId === dispute.id}
                onClick={() => void updateDispute(dispute.id, "ESCALATED")}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Escalate
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}