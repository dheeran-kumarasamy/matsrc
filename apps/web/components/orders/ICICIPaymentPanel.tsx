"use client";

// ICICI Bank Payment Gateway — UAT ONLY builder-facing panel.
//
// Rendered ONLY when the server (orders/[id]/payment/page.tsx) has already
// determined ICICI UAT is available via isIciciUatAvailable() — this
// component itself does not and must not make that decision client-side, it
// only reflects a decision already made server-side (task §9/§24).
import { useState } from "react";
import { builderApiPost } from "@/lib/api";

type InitiateResponse = {
  paymentReference: string;
  merchantTxnNo: string;
  amount?: number;
  redirectUrl?: string | null;
  status: string;
  reused?: boolean;
};

type Props = {
  orderId: string;
  amount: number;
};

export default function ICICIPaymentPanel({ orderId, amount }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function payNow() {
    if (submitting) return; // Prevents double submission (task §24).
    setSubmitting(true);
    setError(null);
    try {
      const result = await builderApiPost<InitiateResponse>(`/orders/${orderId}/payment/icici/initiate`, {});
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      // No redirect URL yet (e.g. gateway accepted but returned no
      // redirect, or a reused in-flight attempt) — surface a clear status
      // instead of silently doing nothing.
      setError(
        result.reused
          ? "A payment is already in progress for this order. Please wait or check your payment status."
          : "Payment was initiated but no redirect was received. Please try again shortly."
      );
    } catch (err: any) {
      setError(err?.message || "Unable to start ICICI payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="posh-card space-y-3 p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="posh-card-title">ICICI Online Payment — UAT</h2>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-800">
          Test Environment
        </span>
      </div>
      <p className="text-sm text-[color:var(--posh-fg-muted)]">
        This is a UAT test payment via ICICI Bank's sandbox gateway. No real money is transferred. Amount payable: ₹
        {amount.toLocaleString("en-IN")}.
      </p>

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      <button
        type="button"
        onClick={payNow}
        disabled={submitting}
        className="posh-btn-solid rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {submitting ? "Redirecting to ICICI UAT…" : "Pay Now (ICICI UAT)"}
      </button>
    </div>
  );
}
