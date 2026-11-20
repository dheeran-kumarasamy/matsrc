"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type BuyerQuoteItem = {
  id: string;
  supplierId: string;
  supplierName: string;
  lineItemId: string;
  materialName: string;
  quantity: number;
  unit: string;
  buyerUnitPrice: number;
  currency: string;
  leadTimeDays: number | null;
  lineSubtotal: number;
  gstRatePercent: number;
  gstAmount: number;
  lineTotal: number;
  sentToBuyerAt: string | null;
  isSelected: boolean;
};

export type BuyerQuotesPayload = {
  orderId: string;
  enquiryId: string;
  status: string;
  isLocked: boolean;
  lockReason: string | null;
  selectedSupplierId: string | null;
  selectedQuoteId: string | null;
  quotes: BuyerQuoteItem[];
};

export function BuyerQuotationSelector({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [data, setData] = useState<BuyerQuotesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectingQuoteId, setSelectingQuoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchQuotes = async () => {
    try {
      const res = await fetch(`/api/builder/orders/${orderId}/quotes`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load quotations:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotes();
  }, [orderId]);

  const handleSelectQuote = async (quote: BuyerQuoteItem) => {
    if (data?.isLocked) return;

    setSelectingQuoteId(quote.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/builder/orders/${orderId}/select-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Failed to select quotation");
      }

      setSuccessMessage(json?.message || "Quotation confirmed successfully.");
      await fetchQuotes();
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Failed to confirm quotation");
    } finally {
      setSelectingQuoteId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Checking available quotations...</p>
      </div>
    );
  }

  if (!data || data.quotes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Quotations Under Review</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Your RFQ has been broadcasted to registered suppliers. Buildohub is reviewing prices and negotiating the best terms. You will receive an alert as soon as quotations are ready.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const hasSelectedQuote = data.quotes.some((q) => q.isSelected);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Quotations for this Enquiry</h3>
          <p className="text-xs text-slate-500">
            Select a quotation to confirm pricing. You may switch to another quotation until a Purchase Order is issued or payment is completed.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {data.quotes.length} Option(s) Available
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-800 border border-rose-200">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-800 border border-emerald-200">
          {successMessage}
        </div>
      )}

      {data.isLocked && (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200 flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          <span>
            <strong>Quotation Locked:</strong> {data.lockReason || "A Purchase Order has been issued or payment has already been made."}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.quotes.map((quote) => (
          <div
            key={quote.id}
            className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
              quote.isSelected
                ? "border-emerald-500 bg-emerald-50/20 ring-1 ring-emerald-500"
                : "border-slate-200 bg-white hover:border-slate-300 shadow-sm"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <span className="font-bold text-slate-900 text-sm">{quote.supplierName}</span>
                {quote.isSelected ? (
                  <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                    Selected
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Option
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Unit Rate:</span>
                  <span className="font-bold text-slate-900">
                    ₹{quote.buyerUnitPrice.toLocaleString("en-IN")}/{quote.unit}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Quantity:</span>
                  <span>{quote.quantity} {quote.unit}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal (Excl. GST):</span>
                  <span>₹{quote.lineSubtotal.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>GST ({quote.gstRatePercent}%):</span>
                  <span>₹{quote.gstAmount.toLocaleString("en-IN")}</span>
                </div>
                {quote.leadTimeDays && (
                  <div className="flex justify-between text-slate-600">
                    <span>Est. Lead Time:</span>
                    <span className="font-medium text-slate-800">{quote.leadTimeDays} business days</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-extrabold text-slate-950">
                  <span>Total Payable:</span>
                  <span>₹{quote.lineTotal.toLocaleString("en-IN")}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100">
              {quote.isSelected ? (
                <button
                  type="button"
                  disabled
                  className="w-full rounded-lg bg-emerald-100 py-2 text-xs font-bold text-emerald-800 cursor-default"
                >
                  ✓ Current Active Quotation
                </button>
              ) : (
                <button
                  type="button"
                  disabled={data.isLocked || selectingQuoteId === quote.id}
                  onClick={() => handleSelectQuote(quote)}
                  className={`w-full rounded-lg py-2 text-xs font-bold transition-all shadow-sm ${
                    data.isLocked
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : hasSelectedQuote
                      ? "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  {selectingQuoteId === quote.id
                    ? "Updating..."
                    : hasSelectedQuote
                    ? "Switch to this Quote"
                    : "Confirm this Quote"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
