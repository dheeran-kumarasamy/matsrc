"use client";

import { useEffect, useState } from "react";
import { adminApiGet, adminApiPost } from "@/lib/api-client";

type SupplierPayment = {
  id: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  remarks: string | null;
  recordedBy: string | null;
  createdAt: string;
};

type PaymentSummary = {
  supplierInvoiceId: string;
  invoiceStatus: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";
  confirmedTotalAmount: number | null;
  amountPaid: number;
  outstandingBalance: number | null;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | null;
  payments: SupplierPayment[];
};

const PAYMENT_METHODS = ["BANK_TRANSFER", "UPI", "NET_BANKING", "CARD", "CREDIT", "COD"] as const;

const STATUS_STYLES: Record<string, string> = {
  UNPAID: "bg-rose-100 text-rose-700",
  PARTIALLY_PAID: "bg-amber-100 text-amber-700",
  PAID: "bg-emerald-100 text-emerald-700",
};

// Minimal Supplier Payment Tracking — a self-contained panel embedded into
// SupplierInvoiceReview.tsx, only once the invoice is CONFIRMED (payments
// are not eligible before then — see SupplierInvoicesService.recordPayment's
// server-side guard, the AUTHORITATIVE enforcement; this component simply
// hides the form earlier for a clean UX). Fetches its own data independently
// of the parent's existing review-form fetch, so adding this panel never
// alters the parent's existing state/props/network calls.
export function SupplierPaymentPanel({ supplierInvoiceId }: { supplierInvoiceId: string }) {
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [paymentReference, setPaymentReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApiGet<PaymentSummary>(`/admin/supplier-invoices/${supplierInvoiceId}/payments`);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierInvoiceId]);

  async function submitPayment() {
    setFormError(null);
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter a valid payment amount greater than zero");
      return;
    }
    if (!paymentDate) {
      setFormError("Enter a payment date");
      return;
    }

    setSubmitting(true);
    try {
      await adminApiPost(`/admin/supplier-invoices/${supplierInvoiceId}/payments`, {
        amount: parsedAmount,
        paymentDate,
        paymentMethod: paymentMethod || undefined,
        paymentReference: paymentReference.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      setAmount("");
      setPaymentReference("");
      setRemarks("");
      // Refresh the balance/history from the server — never computed
      // client-side from the just-submitted form values, so the displayed
      // outstanding balance always reflects the authoritative server state
      // (including any concurrent payment recorded by another admin).
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading payment details…</p>;
  }

  if (error || !summary) {
    return <p className="text-sm font-semibold text-red-700">{error ?? "Payment summary unavailable"}</p>;
  }

  const remainingBalance = summary.outstandingBalance ?? 0;

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Supplier Payment</h3>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs font-semibold text-slate-500">Confirmed Total</p>
          <p className="text-sm font-bold text-slate-900">
            {summary.confirmedTotalAmount !== null ? `₹${summary.confirmedTotalAmount.toLocaleString("en-IN")}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">Amount Paid</p>
          <p className="text-sm font-bold text-slate-900">₹{summary.amountPaid.toLocaleString("en-IN")}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">Outstanding Balance</p>
          <p className="text-sm font-bold text-slate-900">
            {summary.outstandingBalance !== null ? `₹${summary.outstandingBalance.toLocaleString("en-IN")}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">Status</p>
          {summary.paymentStatus ? (
            <span className={`inline-block rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLES[summary.paymentStatus]}`}>
              {summary.paymentStatus.replace("_", " ")}
            </span>
          ) : (
            <span className="text-sm text-slate-500">—</span>
          )}
        </div>
      </div>

      {formError ? <p className="mt-3 text-sm font-semibold text-red-700">{formError}</p> : null}

      {remainingBalance > 0.009 ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              placeholder={`Max ₹${remainingBalance.toLocaleString("en-IN")}`}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Payment Date
            <input
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Payment Method
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">Not specified</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Reference / UTR
            <input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-full text-xs font-semibold text-slate-600">
            Remarks
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional"
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="col-span-full">
            <button
              disabled={submitting}
              onClick={() => void submitPayment()}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {submitting ? "…" : "Record Payment"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-emerald-700">This invoice is fully paid.</p>
      )}

      <div className="mt-4">
        <h4 className="text-sm font-bold text-slate-900">Payment History</h4>
        {summary.payments.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No payments recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {summary.payments.map((p) => (
              <li key={p.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">₹{p.amount.toLocaleString("en-IN")}</span>
                  <span className="text-xs text-slate-500">{new Date(p.paymentDate).toLocaleDateString("en-IN")}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {p.paymentMethod ? p.paymentMethod.replace("_", " ") : "Method not specified"}
                  {p.paymentReference ? ` · Ref: ${p.paymentReference}` : ""}
                </p>
                {p.remarks ? <p className="mt-1 text-xs italic text-slate-500">{p.remarks}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
