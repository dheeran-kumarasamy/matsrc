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
  hasSubmittedQuote?: boolean;
  lines: QuotationLine[];
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
  freightCharges?: number | null;
  loadingCharges?: number | null;
  unloadingCharges?: number | null;
  otherCharges?: number | null;
  dispatchDate?: string | null;
};

function computeLine(quantity: number, unitPrice: number, gstRatePercent: number) {
  const lineSubtotal = quantity * unitPrice;
  const gstAmount = (lineSubtotal * gstRatePercent) / 100;
  const lineTotal = lineSubtotal + gstAmount;
  return { lineSubtotal, gstAmount, lineTotal };
}

function parseOptionalChargeClient(raw: string): { valid: boolean; value: number | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { valid: false, value: null };
  return { valid: true, value: Math.round((n + Number.EPSILON) * 100) / 100 };
}

function validateIndianDate(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return false;
  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) {
    return false;
  }
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return d >= todayUtc;
}

function toIsoDateInput(ddmmyyyy: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function fromIsoDateInput(yyyymmdd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd.trim());
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function RfqQuotationForm({ enquiryId }: { enquiryId: string }) {
  const router = useRouter();
  const [context, setContext] = useState<QuotationContext | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [freightCharges, setFreightCharges] = useState("");
  const [loadingCharges, setLoadingCharges] = useState("");
  const [unloadingCharges, setUnloadingCharges] = useState("");
  const [otherCharges, setOtherCharges] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

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
        setFreightCharges(data.freightCharges != null ? String(data.freightCharges) : "");
        setLoadingCharges(data.loadingCharges != null ? String(data.loadingCharges) : "");
        setUnloadingCharges(data.unloadingCharges != null ? String(data.unloadingCharges) : "");
        setOtherCharges(data.otherCharges != null ? String(data.otherCharges) : "");
        setDispatchDate(data.dispatchDate ?? "");
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

  const parsedFreight = parseOptionalChargeClient(freightCharges);
  const parsedLoading = parseOptionalChargeClient(loadingCharges);
  const parsedUnloading = parseOptionalChargeClient(unloadingCharges);
  const parsedOther = parseOptionalChargeClient(otherCharges);
  const isDispatchDateValid = validateIndianDate(dispatchDate);

  const subtotal = computedLines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const productGst = computedLines.reduce((sum, line) => sum + line.gstAmount, 0);
  const extraChargesSubtotal =
    (parsedFreight.value ?? 0) +
    (parsedLoading.value ?? 0) +
    (parsedUnloading.value ?? 0) +
    (parsedOther.value ?? 0);
  const extraChargesGst = Math.round((extraChargesSubtotal * 0.18 + Number.EPSILON) * 100) / 100;
  const totalGst = Math.round((productGst + extraChargesGst + Number.EPSILON) * 100) / 100;
  const grandTotal = Math.round((subtotal + extraChargesSubtotal + totalGst + Number.EPSILON) * 100) / 100;

  const hasInvalidPrice = computedLines.some((line) => {
    const raw = prices[line.lineItemId];
    const parsed = Number(raw);
    return raw === "" || raw === undefined || !Number.isFinite(parsed) || parsed < 0;
  });

  const hasInvalidOptionalFields =
    !parsedFreight.valid ||
    !parsedLoading.valid ||
    !parsedUnloading.valid ||
    !parsedOther.valid ||
    !isDispatchDateValid;

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
        freightCharges: parsedFreight.value,
        loadingCharges: parsedLoading.value,
        unloadingCharges: parsedUnloading.value,
        otherCharges: parsedOther.value,
        dispatchDate: dispatchDate.trim() || null,
      });
      setSuccess(true);
      setConfirming(false);
      setIsEditing(false);
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
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2">
          <span className="font-bold text-emerald-800">Quotation submitted</span>
          <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-800">Submitted</span>
        </div>
        <p className="mt-1 text-sm text-emerald-700">
          Your quotation has been successfully submitted and sent to the buyer.
        </p>
      </div>
    );
  }

  if (context.hasSubmittedQuote && !isEditing) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-emerald-800">Quotation submitted</span>
              <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-800">Submitted</span>
            </div>
            <p className="mt-1 text-sm text-emerald-700">
              Your quotation for Total {formatInr(context.grandTotal)} (including GST) has been submitted and sent to the buyer.
            </p>
          </div>
          {context.quotable ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
            >
              Revise Quotation
            </button>
          ) : null}
        </div>
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

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-slate-600">
              Additional Charges &amp; Dispatch Details{" "}
              <span className="text-xs font-medium normal-case text-slate-400">(Optional)</span>
            </p>
            <p className="mt-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800">
              These fields are optional and can be left blank. However, providing freight, loading/unloading, other
              charges, and an expected dispatch date gives your quotation a better chance of approval by the admin and
              buyer.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs font-semibold text-slate-700">
            Freight Charges (₹, excl. GST)
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional (e.g. 2500)"
              value={freightCharges}
              onChange={(e) => setFreightCharges(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-normal"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Loading Charges (₹, excl. GST)
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional (e.g. 500)"
              value={loadingCharges}
              onChange={(e) => setLoadingCharges(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-normal"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Unloading Charges (₹, excl. GST)
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional (e.g. 500)"
              value={unloadingCharges}
              onChange={(e) => setUnloadingCharges(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-normal"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Other Charges (₹, excl. GST)
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional"
              value={otherCharges}
              onChange={(e) => setOtherCharges(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-normal"
            />
          </label>
          <div className="block text-xs font-semibold text-slate-700 sm:col-span-2 lg:col-span-2">
            <span>Expected Dispatch Date (DD/MM/YYYY)</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY (Optional)"
                value={dispatchDate}
                onChange={(e) => setDispatchDate(e.target.value)}
                className={`w-full rounded-md border px-2.5 py-1.5 text-sm font-normal ${
                  dispatchDate.trim() && !isDispatchDateValid ? "border-rose-400 bg-rose-50" : "border-slate-300"
                }`}
              />
              <input
                type="date"
                aria-label="Pick dispatch date"
                min={new Date().toISOString().slice(0, 10)}
                value={toIsoDateInput(dispatchDate)}
                onChange={(e) => setDispatchDate(fromIsoDateInput(e.target.value))}
                className="w-10 shrink-0 rounded-md border border-slate-300 px-1.5 py-1.5 text-sm font-normal"
              />
            </div>
            {dispatchDate.trim() && !isDispatchDateValid ? (
              <span className="mt-1 block text-[11px] font-medium text-rose-600">
                Enter a valid today or future date in DD/MM/YYYY format.
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Quotation Summary</p>
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          <div className="flex justify-between">
            <span>Product Value</span>
            <span>{formatInr(subtotal)}</span>
          </div>
          {(parsedFreight.value ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span>Freight Charges</span>
              <span>{formatInr(parsedFreight.value!)}</span>
            </div>
          ) : null}
          {(parsedLoading.value ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span>Loading Charges</span>
              <span>{formatInr(parsedLoading.value!)}</span>
            </div>
          ) : null}
          {(parsedUnloading.value ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span>Unloading Charges</span>
              <span>{formatInr(parsedUnloading.value!)}</span>
            </div>
          ) : null}
          {(parsedOther.value ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span>Other Charges</span>
              <span>{formatInr(parsedOther.value!)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span>GST {extraChargesSubtotal > 0 ? "(incl. 18% on charges)" : ""}</span>
            <span>{formatInr(totalGst)}</span>
          </div>
          {dispatchDate.trim() && isDispatchDateValid ? (
            <div className="flex justify-between text-xs text-slate-500">
              <span>Expected Dispatch Date</span>
              <span className="font-semibold text-slate-700">{dispatchDate.trim()}</span>
            </div>
          ) : null}
          <div className="mt-2 flex justify-between border-t border-slate-300 pt-2 text-base font-extrabold text-slate-900">
            <span>Total Order Value</span>
            <span>{formatInr(grandTotal)}</span>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}

      {!confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={hasInvalidPrice || hasInvalidOptionalFields}
            onClick={() => setConfirming(true)}
            className="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            Review & Submit Quotation
          </button>
          {context.hasSubmittedQuote ? (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          ) : null}
        </div>
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
