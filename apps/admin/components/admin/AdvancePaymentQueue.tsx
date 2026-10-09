"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiPatch } from "@/lib/api-client";

type AdvancePaymentItem = {
  id: string;
  referenceNumber: string;
  buyer: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  amount: number;
  paymentMethod: string;
  paymentReference: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  rejectionReason: string | null;
  screenshotFileName: string | null;
  screenshotUrl: string;
};

// Mirrors apps/admin/components/admin/PaymentVerificationQueue.tsx exactly
// — same approve/reject interaction pattern, reused for the Buildohub
// Advance Payments queue instead of order bank-transfer payments.
export function AdvancePaymentQueue({ items }: { items: AdvancePaymentItem[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setError(null);
    setLoadingId(id);
    try {
      await adminApiPatch(`/admin/advance-payments/${id}/approve`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve advance payment");
    } finally {
      setLoadingId(null);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) {
      setError("Please enter a rejection reason");
      return;
    }
    setError(null);
    setLoadingId(id);
    try {
      await adminApiPatch(`/admin/advance-payments/${id}/reject`, { reason: reason.trim() });
      setRejectingId(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject advance payment");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Buildohub Advance Payments</h3>
      <p className="mt-1 text-sm text-slate-600">Manual advance-payment submissions awaiting admin review.</p>

      {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No advance payments match this filter.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{item.referenceNumber}</p>
                  <p className="text-sm text-slate-600">
                    {item.buyer?.name || item.buyer?.email || "Unknown buyer"}
                    {item.buyer?.phone ? ` · ${item.buyer.phone}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Amount ₹{item.amount.toLocaleString("en-IN")} · {item.paymentMethod}
                    {item.paymentReference ? ` · UTR ${item.paymentReference}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{item.status}</span>
              </div>

              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                Submitted {new Date(item.submittedAt).toLocaleString("en-IN")}
              </p>

              {item.screenshotFileName ? (
                <div className="mt-3">
                  <a
                    href={item.screenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                  >
                    View Payment Screenshot
                  </a>
                </div>
              ) : null}

              {item.status === "PENDING" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    disabled={loadingId === item.id}
                    onClick={() => void approve(item.id)}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {loadingId === item.id ? "…" : "Approve Payment"}
                  </button>
                  <button
                    disabled={loadingId === item.id}
                    onClick={() => setRejectingId(rejectingId === item.id ? null : item.id)}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Reject Payment
                  </button>
                </div>
              ) : null}

              {item.status === "REJECTED" && item.rejectionReason ? (
                <p className="mt-2 text-xs italic text-rose-700">Reason: {item.rejectionReason}</p>
              ) : null}

              {rejectingId === item.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Enter rejection reason"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    rows={2}
                  />
                  <button
                    disabled={loadingId === item.id}
                    onClick={() => void reject(item.id)}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {loadingId === item.id ? "…" : "Confirm Rejection"}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
