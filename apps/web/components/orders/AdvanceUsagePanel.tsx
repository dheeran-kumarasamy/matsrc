"use client";

import { useEffect, useState } from "react";
import { builderApiGet, builderApiPost } from "@/lib/api";

type AdvanceSummary = {
  totalAmount: number;
  advanceApplied: number;
  outstanding: number;
  availableBalance: number;
  accountStatus: string;
};

// Order Payment — Advance Balance is OPTIONAL (spec §19-§27). THE DEFAULT IS
// ALWAYS "Use Advance Balance = No" — the buyer must explicitly select Yes.
// Never automatically consumes the balance. Notifies the parent
// (BankTransferPaymentPanel's amount, via onOutstandingChange) of the
// current post-advance outstanding amount so the remaining payment method
// always charges the correct, server-recomputed amount.
export default function AdvanceUsagePanel({
  orderId,
  onOutstandingChange,
}: {
  orderId: string;
  onOutstandingChange: (outstanding: number) => void;
}) {
  const [summary, setSummary] = useState<AdvanceSummary | null>(null);
  const [useAdvance, setUseAdvance] = useState(false); // DEFAULT: No
  const [amountToUse, setAmountToUse] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    builderApiGet<AdvanceSummary>(`/orders/${orderId}/advance-payment`)
      .then((data) => {
        if (!active) return;
        setSummary(data);
        onOutstandingChange(data.outstanding);
      })
      .catch(() => {
        if (active) setSummary(null);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (!summary || summary.availableBalance <= 0) {
    return null; // Nothing to offer — no advance balance available.
  }

  async function applyAdvance() {
    setError(null);
    setSuccess(null);
    const amount = Number(amountToUse);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid amount to use from your advance balance");
      return;
    }
    setApplying(true);
    try {
      const result = await builderApiPost<{ advanceApplied: number; remainingOutstanding: number; availableBalance: number }>(
        `/orders/${orderId}/advance-payment`,
        { amount }
      );
      setSuccess(`₹${result.advanceApplied.toLocaleString("en-IN")} applied from your advance balance`);
      setSummary((prev) =>
        prev
          ? { ...prev, outstanding: result.remainingOutstanding, availableBalance: result.availableBalance, advanceApplied: prev.advanceApplied + result.advanceApplied }
          : prev
      );
      onOutstandingChange(result.remainingOutstanding);
      setAmountToUse("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply advance balance");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-xl border border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.03)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="posh-label">Buildohub Advance Balance</p>
        <p className="text-sm font-bold text-[color:var(--posh-fg)]">Available ₹{summary.availableBalance.toLocaleString("en-IN")}</p>
      </div>

      <div>
        <p className="posh-label mb-2">Use Advance Balance?</p>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={!useAdvance} onChange={() => setUseAdvance(false)} />
            No
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={useAdvance} onChange={() => setUseAdvance(true)} />
            Yes
          </label>
        </div>
      </div>

      {useAdvance ? (
        <div className="space-y-2">
          <p className="posh-label">Amount to Use</p>
          <input
            type="number"
            min={0}
            max={Math.min(summary.availableBalance, summary.outstanding)}
            step="0.01"
            value={amountToUse}
            onChange={(e) => setAmountToUse(e.target.value)}
            placeholder={`Up to ₹${Math.min(summary.availableBalance, summary.outstanding).toLocaleString("en-IN")}`}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={applyAdvance}
            disabled={applying}
            className="posh-btn-solid rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply Advance"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-[color:var(--posh-fg-muted)]">
          Your advance balance will not be used. The full amount remains payable via your selected payment method.
        </p>
      )}

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-700">{success}</p> : null}

      <div className="flex justify-between border-t border-[color:var(--posh-border)] pt-2 text-sm">
        <span className="text-[color:var(--posh-fg-muted)]">Amount to Pay</span>
        <span className="font-bold text-[color:var(--posh-fg)]">₹{summary.outstanding.toLocaleString("en-IN")}</span>
      </div>
    </div>
  );
}
