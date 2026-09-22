"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiPatch } from "@/lib/api-client";

type PendingPayment = {
  id: string;
  orderId: string;
  orderStatus: string;
  orderTotal: number;
  paymentAmount: number;
  paymentMethod: string;
  customer: { id: string; name: string | null; email: string | null; phone: string | null };
  status: "PENDING" | "APPROVED" | "REJECTED";
  screenshotFileName: string;
  submittedAt: string;
  screenshotUrl: string;
};

export function PaymentVerificationQueue({ items }: { items: PendingPayment[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function approve(orderId: string) {
    setError(null);
    setLoadingId(orderId);
    try {
      await adminApiPatch(`/admin/payments/${orderId}/approve`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve payment");
    } finally {
      setLoadingId(null);
    }
  }

  async function reject(orderId: string) {
    if (!reason.trim()) {
      setError("Please enter a rejection reason");
      return;
    }
    setError(null);
    setLoadingId(orderId);
    try {
      await adminApiPatch(`/admin/payments/${orderId}/reject`, { reason: reason.trim() });
      setRejectingId(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject payment");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Payment Verification Queue</h3>
      <p className="mt-1 text-sm text-slate-600">Bank-transfer payment proofs awaiting admin review.</p>

      {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No payments are currently awaiting verification.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Order #{item.orderId.slice(0, 8)}</p>
                  <p className="text-sm text-slate-600">
                    {item.customer.name || item.customer.email || "Unknown customer"}
                    {item.customer.phone ? ` · ${item.customer.phone}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Order total ₹{item.orderTotal.toLocaleString("en-IN")} · Payment amount ₹
                    {item.paymentAmount.toLocaleString("en-IN")} · {item.paymentMethod}
                  </p>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{item.status}</span>
              </div>

              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                Submitted {new Date(item.submittedAt).toLocaleString("en-IN")}
              </p>

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

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  disabled={loadingId === item.orderId}
                  onClick={() => void approve(item.orderId)}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {loadingId === item.orderId ? "…" : "Approve Payment"}
                </button>
                <button
                  disabled={loadingId === item.orderId}
                  onClick={() => setRejectingId(rejectingId === item.orderId ? null : item.orderId)}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  Reject Payment
                </button>
              </div>

              {rejectingId === item.orderId ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Enter rejection reason"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    rows={2}
                  />
                  <button
                    disabled={loadingId === item.orderId}
                    onClick={() => void reject(item.orderId)}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {loadingId === item.orderId ? "…" : "Confirm Rejection"}
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
