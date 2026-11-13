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
    return invoice.lineItems.map((li) => ({
      orderItemId: li.orderItemId,
      productName: li.productName,
      unitLabel: li.orderUnitLabel,
      originalQuantity: li.originalQuantity,
      originalUnitPrice: li.originalUnitPrice,
      actualQuantity: String(li.actualQuantity),
      supplierInvoicedUnitPrice: li.supplierInvoicedUnitPrice !== null ? String(li.supplierInvoicedUnitPrice) : "",
      approvedUnitPriceOverride: li.rateDiscrepancy ? String(li.approvedUnitPrice) : "",
      unitConfirmed: li.unitConfirmed,
    }));
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
    originalUnitPrice: item.unitPrice,
    actualQuantity: String(item.quantity),
    supplierInvoicedUnitPrice: "",
    approvedUnitPriceOverride: "",
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
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Supplier-Invoiced Rate (if different)
                  <input
                    disabled={readOnly}
                    value={d.supplierInvoicedUnitPrice}
                    onChange={(e) => updateDraft(i, { supplierInvoicedUnitPrice: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    type="number"
                    step="0.01"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Approved Rate Override
                  <input
                    disabled={readOnly}
                    value={d.approvedUnitPriceOverride}
                    onChange={(e) => updateDraft(i, { approvedUnitPriceOverride: e.target.value })}
                    placeholder={`Default: ₹${d.originalUnitPrice}`}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    type="number"
                    step="0.01"
                  />
                </label>
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

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">
            Freight
            <input
              disabled={readOnly}
              value={freightChargeAmount}
              onChange={(e) => setFreightChargeAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
              type="number"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Other Charges
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

        {invoice.confirmedTotalAmount !== null ? (
          <p className="mt-3 text-sm font-bold text-slate-900">
            Confirmed total: ₹{invoice.confirmedTotalAmount.toLocaleString("en-IN")}
          </p>
        ) : null}

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


