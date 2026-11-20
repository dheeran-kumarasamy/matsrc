"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiPatch, adminApiPost } from "@/lib/api-client";
import { SupplierPaymentPanel } from "./SupplierPaymentPanel";

type LineItem = {
  id: string;
  orderItemId: string;
  productName: string | null;
  // Unit display/validation (audit fix). `orderUnitLabel` is the frozen
  // snapshot taken when this line was last reviewed; `unitConfirmed` is
  // the admin's explicit per-line acknowledgment, required before the
  // invoice can be confirmed (see the server-side confirm() guard).
  orderUnitLabel: string | null;
  unitConfirmed: boolean;
  originalQuantity: number;
  originalUnitPrice: number;
  actualQuantity: number;
  approvedUnitPrice: number;
  supplierInvoicedUnitPrice: number | null;
  rateDiscrepancy: boolean;
  applyMarkup?: boolean;
  markupPercent?: number | null;
  taxRatePercent: number | null;
  lineSubtotal: number;
  lineTaxAmount: number;
  lineTotal: number;
};

type OrderItemRef = {
  id: string;
  productName: string | null;
  unitLabel: string | null;
  quantity: number;
  unitPrice: number;
  supplierUnitPrice?: number | null;
  markupPercent?: number | null;
  taxRatePercent: number | null;
};

type SupplierInvoiceDetail = {
  id: string;
  orderId: string;
  enquiryId: string;
  orderNumber: string | null;
  supplier: { id: string; companyName: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
  status: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";
  fileName: string;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: string | null;
  uploadedAt: string;
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
  rejectionReason: string | null;
  confirmedAt: string | null;
  freightChargeAmount: number;
  otherChargesAmount: number;
  discountAmount: number;
  roundingAdjustment: number;
  confirmedTaxableValue: number | null;
  confirmedTaxAmount: number | null;
  confirmedTotalAmount: number | null;
  fileUrl: string;
  orderItems: OrderItemRef[];
  lineItems: LineItem[];
};

type LineDraft = {
  orderItemId: string;
  productName: string | null;
  unitLabel: string | null;
  originalQuantity: number;
  originalUnitPrice: number;
  actualQuantity: string;
  supplierInvoicedUnitPrice: string;
  approvedUnitPriceOverride: string;
  applyMarkup: boolean;
  markupPercent: number | null;
  // Unit-of-measure validation (audit fix): the admin's explicit, per-line
  // acknowledgment that actualQuantity above is genuinely expressed in
  // unitLabel's unit. Re-initialized to the PREVIOUSLY saved value (never
  // defaulted back to true) so editing actualQuantity after a prior
  // confirmation attempt doesn't silently carry forward an unrelated
  // acknowledgment.
  unitConfirmed: boolean;
};

function buildInitialDrafts(invoice: SupplierInvoiceDetail): LineDraft[] {
  if (invoice.lineItems.length > 0) {
    return invoice.lineItems.map((li) => {
      const matchingOrderItem = invoice.orderItems.find((oi) => oi.id === li.orderItemId);
      return {
        orderItemId: li.orderItemId,
        productName: li.productName,
        unitLabel: li.orderUnitLabel,
        originalQuantity: li.originalQuantity,
        originalUnitPrice: li.originalUnitPrice,
        actualQuantity: String(li.actualQuantity),
        supplierInvoicedUnitPrice: li.supplierInvoicedUnitPrice !== null ? String(li.supplierInvoicedUnitPrice) : "",
        approvedUnitPriceOverride: li.rateDiscrepancy ? String(li.approvedUnitPrice) : "",
        applyMarkup: li.applyMarkup !== false,
        markupPercent: li.markupPercent ?? matchingOrderItem?.markupPercent ?? null,
        unitConfirmed: li.unitConfirmed,
      };
    });
  }
  // No review exists yet — seed the form from the order's own line items,
  // defaulting actualQuantity to the originally ordered quantity (the
  // common "nothing changed" case) so the admin only needs to edit the
  // lines that actually differ. unitConfirmed always starts false — never
  // pre-ticked — since nothing has been reviewed yet.
  return invoice.orderItems.map((item) => ({
    orderItemId: item.id,
    productName: item.productName,
    unitLabel: item.unitLabel,
    originalQuantity: item.quantity,
    originalUnitPrice: item.supplierUnitPrice ?? item.unitPrice,
    actualQuantity: String(item.quantity),
    supplierInvoicedUnitPrice: "",
    approvedUnitPriceOverride: "",
    applyMarkup: true,
    markupPercent: item.markupPercent ?? null,
    unitConfirmed: false,
  }));
}

export function SupplierInvoiceReview({ invoice }: { invoice: SupplierInvoiceDetail }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<LineDraft[]>(() => buildInitialDrafts(invoice));
  const [freightChargeAmount, setFreightChargeAmount] = useState(String(invoice.freightChargeAmount || 0));
  const [otherChargesAmount, setOtherChargesAmount] = useState(String(invoice.otherChargesAmount || 0));
  const [discountAmount, setDiscountAmount] = useState(String(invoice.discountAmount || 0));
  const [roundingAdjustment, setRoundingAdjustment] = useState(String(invoice.roundingAdjustment || 0));
  const [discrepancyNotes, setDiscrepancyNotes] = useState(invoice.discrepancyNotes ?? "");
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = invoice.status === "CONFIRMED";

  const anyDiscrepancy = useMemo(
    () =>
      drafts.some((d) => {
        const invoiced = parseFloat(d.supplierInvoicedUnitPrice);
        return !Number.isNaN(invoiced) && Math.abs(invoiced - d.originalUnitPrice) > 0.01;
      }),
    [drafts]
  );

  // Unit-of-measure validation (audit fix): mirrors the server-side
  // confirm() guard client-side so the admin sees why Confirm is disabled
  // rather than discovering it only after a failed request — the
  // AUTHORITATIVE enforcement remains server-side (SupplierInvoicesService
  // .confirm), this is purely a UX convenience.
  const allUnitsConfirmed = useMemo(() => drafts.every((d) => d.unitConfirmed), [drafts]);

  const livePreview = useMemo(() => {
    // Supplier invoice lines total must reflect the supplier-invoiced rate (or agreed rate if unchanged)
    const linesTaxable = drafts.reduce((sum, d) => {
      const qty = parseFloat(d.actualQuantity) || 0;
      const invoicedRate = parseFloat(d.supplierInvoicedUnitPrice);
      const supplierSettlementRate = !Number.isNaN(invoicedRate) && invoicedRate > 0 ? invoicedRate : d.originalUnitPrice;
      return sum + qty * supplierSettlementRate;
    }, 0);
    const linesTax = drafts.reduce((sum, d, i) => {
      const qty = parseFloat(d.actualQuantity) || 0;
      const invoicedRate = parseFloat(d.supplierInvoicedUnitPrice);
      const supplierSettlementRate = !Number.isNaN(invoicedRate) && invoicedRate > 0 ? invoicedRate : d.originalUnitPrice;
      const itemTaxRate = invoice.lineItems[i]?.taxRatePercent ?? invoice.orderItems[i]?.taxRatePercent ?? 18;
      return sum + Math.round((qty * supplierSettlementRate * (itemTaxRate / 100) + Number.EPSILON) * 100) / 100;
    }, 0);

    const freight = parseFloat(freightChargeAmount) || 0;
    const other = parseFloat(otherChargesAmount) || 0;
    const discount = parseFloat(discountAmount) || 0;
    const rounding = parseFloat(roundingAdjustment) || 0;

    const netAdjustment = freight + other - discount;
    const adjustmentTax = netAdjustment > 0 ? Math.round((netAdjustment * 0.18 + Number.EPSILON) * 100) / 100 : 0;
    const taxableValue = linesTaxable + netAdjustment;
    const totalTax = linesTax + adjustmentTax;
    const totalAmount = taxableValue + totalTax + rounding;

    return {
      linesTaxable,
      linesTax,
      freight,
      other,
      discount,
      netAdjustment,
      adjustmentTax,
      taxableValue,
      totalTax,
      rounding,
      totalAmount,
    };
  }, [drafts, freightChargeAmount, otherChargesAmount, discountAmount, roundingAdjustment, invoice]);

  function updateDraft(index: number, patch: Partial<LineDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function saveReview() {
    setError(null);
    setSaving(true);
    try {
      await adminApiPatch(`/admin/supplier-invoices/${invoice.id}/review`, {
        lines: drafts.map((d) => ({
          orderItemId: d.orderItemId,
          actualQuantity: parseFloat(d.actualQuantity),
          supplierInvoicedUnitPrice: d.supplierInvoicedUnitPrice ? parseFloat(d.supplierInvoicedUnitPrice) : null,
          approvedUnitPriceOverride: d.approvedUnitPriceOverride ? parseFloat(d.approvedUnitPriceOverride) : null,
          applyMarkup: d.applyMarkup,
          unitConfirmed: d.unitConfirmed,
        })),
        freightChargeAmount: parseFloat(freightChargeAmount) || 0,
        otherChargesAmount: parseFloat(otherChargesAmount) || 0,
        discountAmount: parseFloat(discountAmount) || 0,
        roundingAdjustment: parseFloat(roundingAdjustment) || 0,
        discrepancyNotes: discrepancyNotes || null,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save review");
    } finally {
      setSaving(false);
    }
  }

  async function confirmInvoice() {
    setError(null);
    setSaving(true);
    try {
      await adminApiPost(`/admin/supplier-invoices/${invoice.id}/confirm`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm invoice");
    } finally {
      setSaving(false);
    }
  }

  async function rejectInvoice() {
    if (!rejectionReason.trim()) {
      setError("Please enter a rejection reason");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await adminApiPatch(`/admin/supplier-invoices/${invoice.id}/reject`, { reason: rejectionReason.trim() });
      setShowRejectForm(false);
      setRejectionReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject invoice");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold text-slate-950">Order #{invoice.orderNumber ?? invoice.enquiryId}</p>
            <p className="text-sm text-slate-600">{invoice.supplier?.companyName ?? "Unknown supplier"}</p>
            {invoice.purchaseOrder ? <p className="text-xs text-slate-500">PO {invoice.purchaseOrder.poNumber}</p> : null}
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
            {invoice.status.replace("_", " ")}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/admin/supplier-invoices/${invoice.id}/file`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
          >
            View Uploaded Invoice ({invoice.fileName})
          </a>
        </div>

        {invoice.supplierInvoiceNumber ? (
          <p className="mt-2 text-xs text-slate-500">
            Supplier ref: {invoice.supplierInvoiceNumber}
            {invoice.supplierInvoiceDate ? ` · ${new Date(invoice.supplierInvoiceDate).toLocaleDateString("en-IN")}` : ""}
          </p>
        ) : null}

        {invoice.status === "REJECTED" && invoice.rejectionReason ? (
          <p className="mt-2 text-xs italic text-rose-700">Rejected: {invoice.rejectionReason}</p>
        ) : null}
      </section>

      {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Line Items — Actual Invoiced Quantities</h3>
        <p className="mt-1 text-sm text-slate-600">
          Enter the ACTUAL invoiced quantity/weight from the supplier&apos;s invoice for each line. The agreed rate is
          used automatically unless you explicitly approve a different rate below.
        </p>

        <div className="mt-3 space-y-3">
          {drafts.map((d, i) => (
            <div key={d.orderItemId} className="rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-bold text-slate-900">{d.productName ?? "Product"}</p>
              <p className="text-xs text-slate-500">
                Ordered: {d.originalQuantity} {d.unitLabel ?? "(unit not recorded)"} × ₹
                {d.originalUnitPrice.toLocaleString("en-IN")}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">
                  Actual Quantity/Weight ({d.unitLabel ?? "unit not recorded"})
                  <input
                    disabled={readOnly}
                    value={d.actualQuantity}
                    onChange={(e) => updateDraft(i, { actualQuantity: e.target.value, unitConfirmed: false })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    type="number"
                    step="0.001"
                  />
                  <span className="block text-[11px] text-slate-400 mt-0.5">Quantity from physical invoice</span>
                </label>

                <label className="text-xs font-semibold text-slate-600">
                  Supplier-Invoiced Rate (if different)
                  <input
                    disabled={readOnly}
                    value={d.supplierInvoicedUnitPrice}
                    onChange={(e) => updateDraft(i, { supplierInvoicedUnitPrice: e.target.value })}
                    placeholder={`Agreed PO: ₹${d.originalUnitPrice.toLocaleString("en-IN")}`}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    type="number"
                    step="0.01"
                  />
                  <span className="block text-[11px] text-slate-400 mt-0.5">Rate supplier billed Buildohub</span>
                </label>

                <div className="flex flex-col justify-between">
                  <label className="text-xs font-semibold text-slate-600">
                    Approved Rate Override
                    <input
                      disabled={readOnly}
                      value={d.approvedUnitPriceOverride}
                      onChange={(e) => updateDraft(i, { approvedUnitPriceOverride: e.target.value })}
                      placeholder={`Default: ₹${d.originalUnitPrice.toLocaleString("en-IN")}`}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      type="number"
                      step="0.01"
                    />
                    <span className="block text-[11px] text-slate-400 mt-0.5">Base rate used for buyer billing</span>
                  </label>

                  {/* Markup control checkbox */}
                  <label className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      checked={d.applyMarkup}
                      onChange={(e) => updateDraft(i, { applyMarkup: e.target.checked })}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      Apply Markup{d.markupPercent != null ? ` (${d.markupPercent}%)` : ""}
                    </span>
                  </label>
                </div>
              </div>

              {/* Live buyer rate calculation preview */}
              <div className="mt-2 flex items-center justify-between text-xs bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-1.5 text-blue-900">
                <span>
                  <strong>Buyer Billed Rate:</strong>{" "}
                  {(() => {
                    const base = d.approvedUnitPriceOverride
                      ? parseFloat(d.approvedUnitPriceOverride) || d.originalUnitPrice
                      : d.originalUnitPrice;
                    const markup = d.applyMarkup && d.markupPercent != null ? d.markupPercent : 0;
                    const buyerRate = Math.round((base * (1 + markup / 100) + Number.EPSILON) * 100) / 100;
                    return `₹${buyerRate.toLocaleString("en-IN")} / ${d.unitLabel ?? "unit"} ${
                      d.applyMarkup && d.markupPercent
                        ? `(Base ₹${base.toLocaleString("en-IN")} + ${markup}% markup)`
                        : `(Flat base rate, no markup)`
                    }`;
                  })()}
                </span>
                <span>
                  <strong>Supplier Settlement Rate:</strong>{" "}
                  {(() => {
                    const invoiced = parseFloat(d.supplierInvoicedUnitPrice);
                    const rate = !Number.isNaN(invoiced) && invoiced > 0 ? invoiced : d.originalUnitPrice;
                    return `₹${rate.toLocaleString("en-IN")} / ${d.unitLabel ?? "unit"}`;
                  })()}
                </span>
              </div>

              {/* Unit-of-measure validation (audit fix): there is no
                  automatic way to detect a genuine unit mismatch (e.g. the
                  supplier's invoice is in tonnes while the order was
                  placed in kg) from an opaque uploaded document — the
                  admin must explicitly check the file and confirm the
                  quantity above uses the SAME unit as the order before
                  this line counts as reviewed for confirmation. */}
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={d.unitConfirmed}
                  onChange={(e) => updateDraft(i, { unitConfirmed: e.target.checked })}
                />
                I confirm the actual quantity above is in {d.unitLabel ?? "the same unit as the order"}, matching the
                supplier&apos;s invoice
              </label>
            </div>
          ))}
        </div>

        {anyDiscrepancy ? (
          <div className="mt-3 rounded-lg bg-orange-50 p-3">
            <p className="text-xs font-bold text-orange-700">
              A supplier-invoiced rate differs from the agreed order rate on one or more lines. Enter an explicit
              Approved Rate Override to accept the new rate, or leave blank to keep the agreed rate.
            </p>
            <label className="mt-2 block text-xs font-semibold text-orange-700">
              Discrepancy notes
              <textarea
                disabled={readOnly}
                value={discrepancyNotes}
                onChange={(e) => setDiscrepancyNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-orange-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
        ) : null}

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-700">Invoice Adjustments (exclusive of GST — 18% GST will be added):</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs font-semibold text-slate-600">
              Freight (excl. GST)
              <input
                disabled={readOnly}
                value={freightChargeAmount}
                onChange={(e) => setFreightChargeAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                type="number"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Other Charges (excl. GST)
              <input
                disabled={readOnly}
                value={otherChargesAmount}
                onChange={(e) => setOtherChargesAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                type="number"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Discount
              <input
                disabled={readOnly}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                type="number"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Rounding
              <input
                disabled={readOnly}
                value={roundingAdjustment}
                onChange={(e) => setRoundingAdjustment(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                type="number"
              />
            </label>
          </div>
        </div>

        {/* Live Calculation Preview */}
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">Calculation Summary</p>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <div>Items Subtotal: ₹{livePreview.linesTaxable.toLocaleString("en-IN")}</div>
            {livePreview.freight > 0 ? <div>Freight (excl. GST): ₹{livePreview.freight.toLocaleString("en-IN")}</div> : null}
            {livePreview.other > 0 ? <div>Other Charges (excl. GST): ₹{livePreview.other.toLocaleString("en-IN")}</div> : null}
            {livePreview.discount > 0 ? <div>Discount: -₹{livePreview.discount.toLocaleString("en-IN")}</div> : null}
            <div className="font-medium text-slate-900">Taxable Value: ₹{livePreview.taxableValue.toLocaleString("en-IN")}</div>
            <div>Items GST: ₹{livePreview.linesTax.toLocaleString("en-IN")}</div>
            {livePreview.netAdjustment > 0 ? (
              <div>GST on Adjustments (@18%): ₹{livePreview.adjustmentTax.toLocaleString("en-IN")}</div>
            ) : null}
            <div className="font-medium text-slate-900">Total GST: ₹{livePreview.totalTax.toLocaleString("en-IN")}</div>
            {livePreview.rounding !== 0 ? (
              <div>Rounding: {livePreview.rounding > 0 ? "+" : "-"}₹{Math.abs(livePreview.rounding).toLocaleString("en-IN")}</div>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-bold text-slate-950">
            {invoice.confirmedTotalAmount !== null ? "Confirmed Total: " : "Estimated Total: "}
            ₹{(invoice.confirmedTotalAmount !== null ? invoice.confirmedTotalAmount : livePreview.totalAmount).toLocaleString("en-IN")}
          </p>
        </div>

        {!readOnly ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              disabled={saving}
              onClick={() => void saveReview()}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? "…" : "Save Review"}
            </button>
            <button
              disabled={saving || invoice.lineItems.length === 0 || !allUnitsConfirmed}
              onClick={() => void confirmInvoice()}
              title={!allUnitsConfirmed ? "Confirm the unit of measure for every line before confirming" : undefined}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? "…" : "Confirm Invoice"}
            </button>
            <button
              disabled={saving}
              onClick={() => setShowRejectForm((v) => !v)}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Reject Invoice
            </button>
          </div>
        ) : null}

        {showRejectForm ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter rejection reason"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              rows={2}
            />
            <button
              disabled={saving}
              onClick={() => void rejectInvoice()}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? "…" : "Confirm Rejection"}
            </button>
          </div>
        ) : null}
      </section>

      {invoice.status === "CONFIRMED" ? <SupplierPaymentPanel supplierInvoiceId={invoice.id} /> : null}
    </div>
  );
}


