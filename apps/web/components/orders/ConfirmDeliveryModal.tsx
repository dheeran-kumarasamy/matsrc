"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ConfirmDeliveryModalProps {
  orderId: string;
  orderNumber?: string | null;
  initialReceiverName?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ConfirmDeliveryModal({
  orderId,
  orderNumber,
  initialReceiverName = "",
  isOpen,
  onClose,
  onSuccess,
}: ConfirmDeliveryModalProps) {
  const router = useRouter();
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [receivedBy, setReceivedBy] = useState(initialReceiverName);
  const [notes, setNotes] = useState("");
  const [verifiedCheck, setVerifiedCheck] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!verifiedCheck) {
      setError("Please confirm physical verification of materials.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/builder/orders/${orderId}/confirm-delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receivedDate,
          receivedBy: receivedBy.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to confirm delivery.");
      }

      onClose();
      if (onSuccess) {
        onSuccess();
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred while confirming delivery.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        style={{ borderColor: "var(--posh-border)" }}
      >
        <div className="flex items-start justify-between border-b pb-3 dark:border-slate-800">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Site Verification &amp; Receipt
            </span>
            <h3 className="mt-0.5 text-lg font-extrabold text-slate-950 dark:text-slate-50">
              Confirm Material Delivery
            </h3>
            {orderNumber ? (
              <p className="text-xs text-slate-500">Order: {orderNumber}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Delivery Date
            </label>
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Verified &amp; Received By (Site Engineer / Representative)
            </label>
            <input
              type="text"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="e.g. John Doe (Site Incharge)"
              required
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Verification Notes / Remarks <span className="font-normal text-slate-400">(Optional)</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Materials unloaded and counted in good condition."
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-950 dark:bg-emerald-950/20">
            <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={verifiedCheck}
                onChange={(e) => setVerifiedCheck(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                I confirm that the materials have been physically received and verified against the Delivery Challan at the construction site.
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !verifiedCheck}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? "Confirming..." : "Confirm & Accept Delivery"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

