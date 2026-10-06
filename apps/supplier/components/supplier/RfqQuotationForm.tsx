"use client";

// Supplier RFQ Price Revision & GST-Inclusive Order Value.
//
// Lets a supplier change the quoted selling price for each enquiry/RFQ line
// item before submitting a quotation (spec §2), pre-populated with the
// existing applicable supplier/tier price (spec §3), with quantity fixed
// (spec §4) and GST/subtotal/total recalculated live client-side as the
// price changes (spec §9) purely for display — the server always
// recalculates and validates everything on submission (spec §11).
//
// Fetches its data from GET /api/supplier/rfqs/:id/quotation
// (getEnquiryQuotationContext) and submits to the EXISTING
// POST /api/supplier/rfqs/:id/quote endpoint (createSupplierQuote), now
// extended to accept `lineQuotes` — no parallel quotation endpoint is
// introduced, per spec §23.

import axios from "axios";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

type QuotationLine = {
  lineItemId: string;
  productName: string;
  brand: string | null;
  quantity: number;
  unit: string;
  gstRatePercent: number;
  initialUnitPrice: number;
  lineSubtotal: number;
  gstAmount: number;
  lineTotal: number;
};

type QuotationContext = {
  enquiryId: string;
  displayEnquiryId: string;
  quotable: boolean;
  lines: QuotationLine[];
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
};

function computeLine(quantity: number, unitPrice: number, gstRatePercent: number) {
  const lineSubtotal = quantity * unitPrice;
  const gstAmount = (lineSubtotal * gstRatePercent) / 100;
  const lineTotal = lineSubtotal + gstAmount;
  return { lineSubtotal, gstAmount, lineTotal };
}

export function RfqQuotationForm({ enquiryId }: { enquiryId: string }) {
  const router = useRouter();
  const [context, setContext] = useState<QuotationContext | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios
      .get<QuotationContext>(`/api/supplier/rfqs/${enquiryId}/quotation`)
      .then(({ data }) => {
        if (cancelled) return;
        setContext(data);
        const initial: Record<string, string> = {};
        for (const line of data.lines) {
          initial[line.lineItemId] = line.initialUnitPrice.toString();
        }
        setPrices(initial);
      })
      .catch(() => {
        if (!cancelled) setContext(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enquiryId]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading quotation...</p>;
  }

  if (!context) {
    return <p className="text-sm text-rose-600">Unable to load this RFQ for quotation.</p>;
  }

  if (!context.quotable) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
        This RFQ is no longer available for quotation.
      </div>
    );
  }

  // Client-side recalculation (display only — spec §9/§10): recomputed on
  // every price edit using the SAME quantity * unitPrice -> GST -> total
  // formula the server uses, so what the supplier sees matches what the
  // server will calculate — but the server always re-derives these values
  // itself at submission time (see createSupplierQuote ->
  // createEnquiryLineQuotesForSupplier), never trusting these numbers.
  const computedLines = context.lines.map((line) => {
    const entered = Number(prices[line.lineItemId]);
    const unitPrice = Number.isFinite(entered) && entered >= 0 ? entered : 0;
    const { lineSubtotal, gstAmount, lineTotal } = computeLine(line.quantity, unitPrice, line.gstRatePercent);
    return { ...line, unitPrice, lineSubtotal, gstAmount, lineTotal };
  });

  const subtotal = computedLines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const totalGst = computedLines.reduce((sum, line) => sum + line.gstAmount, 0);
  const grandTotal = subtotal + totalGst;

  const hasInvalidPrice = computedLines.some((line) => {
    const raw = prices[line.lineItemId];
    const parsed = Number(raw);
    return raw === "" || raw === undefined || !Number.isFinite(parsed) || parsed < 0;
  });

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await axios.post(`/api/supplier/rfqs/${enquiryId}/quote`, {
        price: computedLines[0]?.unitPrice?.toString() ?? "0",
        lineQuotes: computedLines.map((line) => ({
          lineItemId: line.lineItemId,
          unitPrice: prices[line.lineItemId],
        })),
      });
      setSuccess(true);
      setConfirming(false);
      router.refresh();
    } catch (err: any) {
      // Entered prices are deliberately NOT cleared here (spec §19) — the
      // supplier can retry without re-typing every price.
      setError(err?.response?.data?.message ?? "Unable to submit quotation. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
        Quotation submitted.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 font-semibold">Qty</th>
              <th className="px-3 py-2 font-semibold">Quoted Unit Price</th>
              <th className="px-3 py-2 font-semibold">GST</th>
              <th className="px-3 py-2 font-semibold">Subtotal</th>
              <th className="px-3 py-2 font-semibold">GST Amt</th>
              <th className="px-3 py-2 font-semibold">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {computedLines.map((line) => (
              <tr key={line.lineItemId} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-700">
                  {line.brand ? <span className="font-semibold text-slate-800">{line.brand} </span> : null}
                  {line.productName}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {line.quantity} {line.unit}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={prices[line.lineItemId] ?? ""}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [line.lineItemId]: e.target.value }))}
                    className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    aria-label={`Quoted unit price for ${line.productName}`}
                  />
                </td>
                <td className="px-3 py-2 text-slate-700">{line.gstRatePercent}%</td>
                <td className="px-3 py-2 text-slate-700">{formatInr(line.lineSubtotal)}</td>
                <td className="px-3 py-2 text-slate-700">{formatInr(line.gstAmount)}</td>
                <td className="px-3 py-2 font-semibold text-slate-900">{formatInr(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Quotation Summary</p>
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          <div className="flex justify-between">
            <span>Product Value</span>
            <span>{formatInr(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>GST</span>
            <span>{formatInr(totalGst)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-300 pt-2 text-base font-extrabold text-slate-900">
            <span>Total Order Value</span>
            <span>{formatInr(grandTotal)}</span>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}

      {!confirming ? (
        <button
          type="button"
          disabled={hasInvalidPrice}
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          Review & Submit Quotation
        </button>
      ) : (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm font-semibold text-orange-800">
            You are submitting a quotation for: Subtotal {formatInr(subtotal)}, GST {formatInr(totalGst)}, Total
            Order Value {formatInr(grandTotal)}.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Quotation"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
