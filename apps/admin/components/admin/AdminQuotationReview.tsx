"use client";

import { useState } from "react";

export type AdminSupplierQuote = {
  id: string;
  enquiryId: string;
  supplierId: string;
  supplierName: string;
  lineItemId: string;
  materialName: string;
  quantity: number;
  unit: string;
  supplierUnitPrice: number;
  currency: string;
  leadTimeDays: number | null;
  freightCharges?: number | null;
  loadingCharges?: number | null;
  unloadingCharges?: number | null;
  otherCharges?: number | null;
  chargesSubtotal?: number;
  chargesGstAmount?: number;
  chargesTotal?: number;
  dispatchDate?: string | null;
  status: "PENDING_ADMIN_REVIEW" | "SENT_TO_BUYER" | "REJECTED";
  sentToBuyerAt: string | null;
  reviewedByAdminId: string | null;
  adminNotes: string | null;
  createdAt: string;
  markupPercent: number;
  markupAmount: number;
  buyerUnitPrice: number;
  buyerLineSubtotal: number;
  gstRatePercent: number;
  buyerGstAmount: number;
  buyerLineTotal: number;
  isCurrentlySelected: boolean;
};

export type AdminQuotationData = {
  orderId: string;
  enquiryId: string;
  status: string;
  paymentStatus: string;
  isLocked: boolean;
  lockReason: string | null;
  selectedSupplierId: string | null;
  selectedQuoteId: string | null;
  quotes: AdminSupplierQuote[];
};

export function AdminQuotationReview({ initialData }: { initialData: AdminQuotationData }) {
  const [data, setData] = useState<AdminQuotationData>(initialData);
  const [markupEdits, setMarkupEdits] = useState<
    Record<string, { markupPercent: number; buyerUnitPrice: number; adminNotes: string }>
  >(() => {
    const edits: Record<string, { markupPercent: number; buyerUnitPrice: number; adminNotes: string }> = {};
    for (const q of initialData.quotes) {
      edits[q.id] = {
        markupPercent: q.markupPercent,
        buyerUnitPrice: q.buyerUnitPrice,
        adminNotes: q.adminNotes || "",
      };
    }
    return edits;
  });

  const [loadingQuoteId, setLoadingQuoteId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleMarkupPercentChange = (quote: AdminSupplierQuote, newPercent: number) => {
    const validPercent = Number.isFinite(newPercent) && newPercent >= 0 ? newPercent : 0;
    const derivedBuyerPrice = Math.round((quote.supplierUnitPrice * (1 + validPercent / 100) + Number.EPSILON) * 100) / 100;

    setMarkupEdits((prev) => ({
      ...prev,
      [quote.id]: {
        ...(prev[quote.id] || { adminNotes: "" }),
        markupPercent: validPercent,
        buyerUnitPrice: derivedBuyerPrice,
      },
    }));
  };

  const handleBuyerUnitPriceChange = (quote: AdminSupplierQuote, newPrice: number) => {
    const validPrice = Number.isFinite(newPrice) && newPrice >= 0 ? newPrice : 0;
    const markupAmt = Math.max(0, validPrice - quote.supplierUnitPrice);
    const derivedPercent = quote.supplierUnitPrice > 0
      ? Math.round(((markupAmt / quote.supplierUnitPrice) * 100 + Number.EPSILON) * 100) / 100
      : 0;

    setMarkupEdits((prev) => ({
      ...prev,
      [quote.id]: {
        ...(prev[quote.id] || { adminNotes: "" }),
        markupPercent: derivedPercent,
        buyerUnitPrice: validPrice,
      },
    }));
  };

  const handleNotesChange = (quoteId: string, notes: string) => {
    setMarkupEdits((prev) => ({
      ...prev,
      [quoteId]: {
        ...(prev[quoteId] || { markupPercent: 0, buyerUnitPrice: 0 }),
        adminNotes: notes,
      },
    }));
  };

  const handleReviewAction = async (quote: AdminSupplierQuote, action: "SEND_TO_BUYER" | "REJECT") => {
    setLoadingQuoteId(quote.id);
    setMessage(null);

    const edit = markupEdits[quote.id] || {
      markupPercent: quote.markupPercent,
      buyerUnitPrice: quote.buyerUnitPrice,
      adminNotes: "",
    };

    try {
      const response = await fetch(`/api/admin/orders/${data.orderId}/quotes/${quote.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          markupPercent: edit.markupPercent,
          buyerUnitPrice: edit.buyerUnitPrice,
          adminNotes: edit.adminNotes,
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData?.error || resData?.message || "Failed to process quote review");
      }

      setMessage({
        type: "success",
        text: action === "SEND_TO_BUYER" ? "Quotation successfully released to buyer!" : "Quotation marked as rejected.",
      });

      // Refetch latest quotes
      const refreshed = await fetch(`/api/admin/orders/${data.orderId}/quotes`).then((r) => r.json());
      if (refreshed?.quotes) {
        setData(refreshed);
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "An error occurred." });
    } finally {
      setLoadingQuoteId(null);
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`rounded-lg p-4 text-sm font-medium ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {data.isLocked && (
        <div className="rounded-lg bg-amber-50 p-4 border border-amber-200 text-amber-900 text-sm">
          <p className="font-semibold">Order Locked</p>
          <p className="mt-1">
            {data.lockReason || "A Purchase Order has been issued or payment has already been made."} Quotations cannot
            be modified or sent.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Supplier Quotations & Markup Review</h2>
          <p className="text-sm text-slate-500">
            Review raw supplier quotations, adjust platform markup, and choose what quotations to release to the buyer.
          </p>
        </div>
        {data.quotes.length > 0 ? (
          (() => {
            const distinctSuppliersCount = new Set(data.quotes.map((q) => q.supplierId)).size;
            const sentSuppliersCount = new Set(
              data.quotes.filter((q) => q.status === "SENT_TO_BUYER").map((q) => q.supplierId)
            ).size;
            return (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {sentSuppliersCount > 0
                  ? `${sentSuppliersCount} of ${distinctSuppliersCount} Sent to Buyer (${data.quotes.length} item quote${data.quotes.length === 1 ? "" : "s"})`
                  : `${distinctSuppliersCount} Supplier Quote${distinctSuppliersCount === 1 ? "" : "s"} Received (${data.quotes.length} item quote${data.quotes.length === 1 ? "" : "s"})`}
              </span>
            );
          })()
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            0 Quotes Received
          </span>
        )}
      </div>

      {data.quotes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No supplier quotations have been submitted for this enquiry yet.
        </div>
      ) : (
        <div className="space-y-4">
          {data.quotes.map((quote) => {
            const edit = markupEdits[quote.id] || {
              markupPercent: quote.markupPercent,
              buyerUnitPrice: quote.buyerUnitPrice,
              adminNotes: quote.adminNotes || "",
            };

            const subtotal = edit.buyerUnitPrice * quote.quantity;
            const gstAmount = Math.round(((subtotal * quote.gstRatePercent) / 100 + Number.EPSILON) * 100) / 100;
            const total = subtotal + gstAmount;

            return (
              <div
                key={quote.id}
                className={`rounded-xl border p-5 transition-all ${
                  quote.isCurrentlySelected
                    ? "border-emerald-500 bg-emerald-50/20 shadow-sm"
                    : quote.status === "SENT_TO_BUYER"
                    ? "border-blue-200 bg-blue-50/10"
                    : quote.status === "REJECTED"
                    ? "border-slate-200 bg-slate-50 opacity-60"
                    : "border-slate-200 bg-white shadow-sm"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{quote.supplierName}</span>
                      {quote.isCurrentlySelected && (
                        <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
                          Buyer Selected
                        </span>
                      )}
                      {quote.status === "SENT_TO_BUYER" && !quote.isCurrentlySelected && (
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          Released to Buyer
                        </span>
                      )}
                      {quote.status === "PENDING_ADMIN_REVIEW" && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Pending Admin Review
                        </span>
                      )}
                      {quote.status === "REJECTED" && (
                        <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                          Rejected
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Material: <strong className="text-slate-800">{quote.materialName}</strong> ({quote.quantity}{" "}
                      {quote.unit}) · Submitted on {new Date(quote.createdAt).toLocaleString("en-IN")}
                      {quote.leadTimeDays ? ` · Lead Time: ${quote.leadTimeDays} days` : ""}
                      {quote.dispatchDate ? ` · Dispatch Date: ${quote.dispatchDate}` : ""}
                    </p>
                    {(quote.chargesSubtotal ?? 0) > 0 ? (
                      <p className="mt-1 text-xs text-slate-600">
                        Extra Charges (excl. GST):
                        {quote.freightCharges ? ` Freight ₹${quote.freightCharges.toLocaleString("en-IN")}` : ""}
                        {quote.loadingCharges ? ` · Loading ₹${quote.loadingCharges.toLocaleString("en-IN")}` : ""}
                        {quote.unloadingCharges ? ` · Unloading ₹${quote.unloadingCharges.toLocaleString("en-IN")}` : ""}
                        {quote.otherCharges ? ` · Other ₹${quote.otherCharges.toLocaleString("en-IN")}` : ""}
                        {` (+ 18% GST ₹${(quote.chargesGstAmount ?? 0).toLocaleString("en-IN")} = ₹${(quote.chargesTotal ?? 0).toLocaleString("en-IN")})`}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-right">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Supplier Base Price</span>
                    <p className="text-lg font-bold text-slate-900">
                      ₹{quote.supplierUnitPrice.toLocaleString("en-IN")}{" "}
                      <span className="text-xs font-normal text-slate-500">/{quote.unit}</span>
                    </p>
                  </div>
                </div>

                {/* Markup & Buyer Price Controls */}
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Markup %
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      disabled={data.isLocked || loadingQuoteId === quote.id}
                      value={edit.markupPercent}
                      onChange={(e) => handleMarkupPercentChange(quote, parseFloat(e.target.value) || 0)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Buyer Price (₹/{quote.unit})
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={data.isLocked || loadingQuoteId === quote.id}
                      value={edit.buyerUnitPrice}
                      onChange={(e) => handleBuyerUnitPriceChange(quote, parseFloat(e.target.value) || 0)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                    />
                  </div>

                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Subtotal (Excl. GST)
                    </span>
                    <p className="mt-2 text-sm font-semibold text-slate-700">₹{subtotal.toLocaleString("en-IN")}</p>
                    <span className="text-xs text-slate-400">+ GST ({quote.gstRatePercent}%): ₹{gstAmount.toLocaleString("en-IN")}</span>
                  </div>

                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Buyer Total Payable
                    </span>
                    <p className="mt-1 text-xl font-extrabold text-slate-950">₹{total.toLocaleString("en-IN")}</p>
                    <span className="text-xs text-slate-500">Gross Margin: ₹{((edit.buyerUnitPrice - quote.supplierUnitPrice) * quote.quantity).toLocaleString("en-IN")}</span>
                  </div>
                </div>

                {/* Notes and Actions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="flex-1 min-w-[200px]">
                    <input
                      type="text"
                      placeholder="Admin notes (optional, internal only)..."
                      disabled={data.isLocked || loadingQuoteId === quote.id}
                      value={edit.adminNotes}
                      onChange={(e) => handleNotesChange(quote.id, e.target.value)}
                      className="w-full rounded border border-slate-200 px-3 py-1 text-xs text-slate-700 focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                    />
                  </div>

                  {!data.isLocked && (
                    <div className="flex items-center gap-2">
                      {quote.status !== "REJECTED" && (
                        <button
                          type="button"
                          disabled={loadingQuoteId === quote.id}
                          onClick={() => handleReviewAction(quote, "REJECT")}
                          className="rounded px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          Reject Quote
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={loadingQuoteId === quote.id}
                        onClick={() => handleReviewAction(quote, "SEND_TO_BUYER")}
                        className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {loadingQuoteId === quote.id
                          ? "Processing..."
                          : quote.status === "SENT_TO_BUYER"
                          ? "Update & Re-send"
                          : "Approve & Send to Buyer"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
