"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { builderApiPatch, builderApiPost } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CANCELLATION_REASONS,
  isBuilderCancellableOrderStatus,
  type CancellationReasonKey,
  type OrderStatus,
} from "@/lib/order-cancellation";

type PurchaseOrderLineItem = {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  tax: number;
  deliveryDate: string | null;
  fulfilledQuantity: number;
  lineTotal: number;
};

type PurchaseOrderDetail = {
  id: string;
  poNumber: string;
  status: "DRAFT" | "ISSUED" | "ACKNOWLEDGED" | "FULFILLED";
  version: number;
  notes: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  orderId: string;
  // Underlying Order.status — gates whether "Cancel Order" is offered (see
  // lib/order-cancellation.ts's isBuilderCancellableOrderStatus).
  orderStatus?: OrderStatus | null;
  // The order's tagged construction Site (nullable) — carried forward as a
  // convenience into a fresh /sourcing session via "Create New Enquiry".
  orderSiteId?: string | null;
  supplier: { id: string; companyName: string };
  builder: { id: string; name: string; email: string };
  lineItems: PurchaseOrderLineItem[];
  total: number;
  exportUrl: string;
};

// Monochrome status treatment — matches the PO list page (site-wide black &
// white palette); the terminal state is the only solid-black badge.
const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-[rgba(var(--posh-wash-rgb),0.04)] text-[color:var(--posh-fg-muted)] border-[color:var(--posh-border)]",
  ISSUED: "bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)] border-[color:var(--posh-border)]",
  ACKNOWLEDGED: "bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)] border-[color:var(--posh-primary)]",
  FULFILLED: "bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)] border-[color:var(--posh-primary)]",
};

// UF-04/PO: In-app review, edit, digital approval and issuance of a Purchase Order.
// Approval requires a 6-digit OTP (e-signature equivalent) — no physical signature,
// stamp, print, or upload is ever required.
export default function PurchaseOrderApprovalCard({ po: initialPo }: { po: PurchaseOrderDetail }) {
  const router = useRouter();
  const [po, setPo] = useState(initialPo);
  const [notes, setNotes] = useState(po.notes ?? "");
  const [lineItems, setLineItems] = useState(po.lineItems);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approverDesignation, setApproverDesignation] = useState("");
  const [error, setError] = useState<string | null>(null);
  // C37 fix: an explicit Send OTP step — the previous implementation let the
  // user type any 6-digit number straight into the approval form with no
  // OTP ever actually sent. `sendingOtp`/`otpSent`/`otpDeliveryMessage`
  // drive that new step; `otpSent` gates whether the OTP input is shown at
  // all (no OTP field is rendered until a real send has been attempted).
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpDeliveryMessage, setOtpDeliveryMessage] = useState<string | null>(null);

  // "Need to change the quantity?" flow (§ create new enquiry / cancel order)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelledOrderStatus, setCancelledOrderStatus] = useState<OrderStatus | null>(null);
  // Lightweight cancellation reason (§5) — persisted into OrderTracking.note
  // by the API (see formatBuilderCancellationNote in lib/order-cancellation.ts).
  const [cancelReason, setCancelReason] = useState<CancellationReasonKey | null>(null);
  const [cancelOtherDetail, setCancelOtherDetail] = useState("");

  const isDraft = po.status === "DRAFT";
  const currentOrderStatus = cancelledOrderStatus ?? po.orderStatus ?? null;
  const canCancelOrder = currentOrderStatus !== null && isBuilderCancellableOrderStatus(currentOrderStatus);

  // "Create New Enquiry" carries forward the product/material name and the
  // order's tagged site as a convenience (§1) — quantity is deliberately
  // NEVER included, so the builder must explicitly enter/select the new
  // required quantity on the sourcing page itself.
  const newEnquiryParams = new URLSearchParams({ fromPo: "1" });
  const firstProductName = po.lineItems[0]?.productName;
  if (firstProductName) newEnquiryParams.set("material", firstProductName);
  if (po.orderSiteId) newEnquiryParams.set("siteId", po.orderSiteId);
  const newEnquiryHref = `/sourcing?${newEnquiryParams.toString()}`;

  async function cancelOrder() {
    setCancelling(true);
    setCancelError(null);
    try {
      const result = await builderApiPost<{ id: string; status: OrderStatus }>(
        `/orders/${po.orderId}/cancel`,
        {
          reason: cancelReason,
          otherDetail: cancelReason === "OTHER" ? cancelOtherDetail : undefined,
        }
      );
      setCancelledOrderStatus(result.status);
      setShowCancelConfirm(false);
      router.refresh();
    } catch {
      setCancelError("Could not cancel this order right now. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  function updateDeliveryDate(id: string, deliveryDate: string) {
    setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, deliveryDate } : li)));
  }

  async function saveDraft() {
    setSaving(true);
    setError(null);
    try {
      const updated = await builderApiPatch<PurchaseOrderDetail>(`/purchase-orders/${po.id}`, {
        notes,
        // Quantity is not sent — it is read-only on the PO and always mirrors the
        // confirmed order quantity. The backend ignores/rejects it regardless.
        lineItems: lineItems.map((li) => ({
          id: li.id,
          deliveryDate: li.deliveryDate,
        })),
      });
      setPo(updated);
      setLineItems(updated.lineItems);
      router.refresh();
    } catch {
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // C37 fix: sends a real, PO-scoped OTP via the new /send-otp endpoint
  // before any OTP input is shown. Never claims success without an honest
  // delivery outcome — the server's message (e.g. "OTP sent to your
  // registered email (jo***@example.com)." when MSG91 SMS is stubbed) is
  // surfaced verbatim rather than a generic "OTP sent".
  async function sendOtp() {
    setSendingOtp(true);
    setError(null);
    setOtpDeliveryMessage(null);
    try {
      const result = await builderApiPost<{ message?: string }>(`/purchase-orders/${po.id}/send-otp`, {});
      setOtpDeliveryMessage(result.message ?? "OTP sent.");
      setOtpSent(true);
    } catch (err: any) {
      setError(err.message ?? "Could not send the OTP. Please try again.");
    } finally {
      setSendingOtp(false);
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const updated = await builderApiPost<PurchaseOrderDetail>(`/purchase-orders/${po.id}/approve`, {
        otp,
        approverName,
        approverDesignation,
      });
      setPo(updated);
      setShowOtp(false);
      setOtp("");
      setOtpSent(false);
      setOtpDeliveryMessage(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Approval failed. Check the OTP and try again.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">
            {po.poNumber}
            {po.version > 1 ? <span className="ml-2 text-sm text-slate-400">v{po.version}</span> : null}
          </h2>
          <p className="text-sm text-slate-600">Supplier: {po.supplier.companyName}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[po.status] ?? ""}`}>
          {po.status}
        </span>
      </div>

      {po.approvedAt ? (
        <div className="panel border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.04)] p-4 text-sm font-medium text-[color:var(--posh-fg)]">
          Digitally approved{po.approvedBy ? ` by ${po.approvedBy}` : ""} on{" "}
          {new Date(po.approvedAt).toLocaleString()}. This OTP-based approval is the legal e-signature equivalent —
          no physical signature was required.
        </div>
      ) : null}

      <div className="panel overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="font-semibold text-slate-800">Line Items</h3>
          {isDraft ? (
            <p className="text-xs text-slate-500">
              Quantity is based on the confirmed order and cannot be changed here. Adjust the
              delivery date within supplier-allowed limits before approval.
            </p>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Product</th>
                <th className="px-4 py-2 font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Unit Price</th>
                <th className="px-4 py-2 font-semibold">Delivery</th>
                <th className="px-4 py-2 font-semibold">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-800">{li.productName}</td>
                  <td className="px-4 py-2">
                    {/* Quantity is read-only on the PO — it always mirrors the confirmed
                        order quantity and cannot be edited directly here. To change it,
                        modify the order through the order modification process. */}
                    <span className="text-slate-700">
                      {li.quantity} {li.unit}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700">₹{li.unitPrice.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2">
                    {isDraft ? (
                      <input
                        type="date"
                        value={li.deliveryDate ? li.deliveryDate.slice(0, 10) : ""}
                        onChange={(e) => updateDeliveryDate(li.id, e.target.value)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="text-slate-700">
                        {li.deliveryDate ? new Date(li.deliveryDate).toLocaleDateString() : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-800">
                    ₹{(li.unitPrice * li.quantity + li.tax).toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <span className="text-sm text-slate-500">Total</span>
          <span className="text-lg font-extrabold text-slate-900">₹{po.total.toLocaleString("en-IN")}</span>
        </div>
      </div>

      {/* Quantity is read-only end to end — instead of an edit control, offer
          the two sanctioned paths to change it: start a fresh enquiry through
          the existing sourcing flow, or cancel this order (subject to the
          existing cancellation rules) so a new one can be placed. Neither
          action ever modifies this PO's historical quantity. */}
      <div className="panel space-y-3 p-4">
        <h4 className="font-semibold text-slate-800">Need to change the quantity?</h4>
        <p className="text-sm text-slate-600">
          The quantity on a confirmed order cannot be edited. Create a new enquiry with the required quantity to
          place a new order.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={newEnquiryHref}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Create New Enquiry
          </Link>
          {canCancelOrder ? (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="rounded-md border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700"
            >
              Cancel Order
            </button>
          ) : null}
        </div>
        {cancelledOrderStatus === "CANCELLED" ? (
          <p className="text-sm font-semibold text-slate-700">This order has been cancelled.</p>
        ) : null}
        {cancelError ? <p className="text-sm text-rose-600">{cancelError}</p> : null}
      </div>

      <Dialog
        open={showCancelConfirm}
        onOpenChange={(open) => {
          setShowCancelConfirm(open);
          if (!open) {
            // Reset the reason picker each time the dialog is dismissed, so a
            // stale choice from a previous open never silently carries over.
            setCancelReason(null);
            setCancelOtherDetail("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-600">
              This will cancel the current order. The confirmed quantity on the existing Purchase Order will
              remain unchanged.
            </p>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-800">
                Why are you cancelling? <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {CANCELLATION_REASONS.map((reason) => (
                  <button
                    key={reason.key}
                    type="button"
                    onClick={() => setCancelReason((current) => (current === reason.key ? null : reason.key))}
                    disabled={cancelling}
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                      cancelReason === reason.key
                        ? "border-slate-800 bg-slate-800 text-white"
                        : "border-slate-300 text-slate-700"
                    }`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
              {cancelReason === "OTHER" ? (
                <input
                  type="text"
                  value={cancelOtherDetail}
                  onChange={(e) => setCancelOtherDetail(e.target.value)}
                  maxLength={200}
                  placeholder="Optional short explanation"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              ) : null}
            </div>
            {cancelError ? <p className="text-sm text-rose-600">{cancelError}</p> : null}
            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelling}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                Keep Order
              </button>
              <button
                onClick={cancelOrder}
                disabled={cancelling}
                className="flex-1 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
              >
                {cancelling ? "Cancelling..." : "Cancel Order"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isDraft ? (
        <div className="panel p-4">
          <label className="mb-1 block text-sm font-semibold text-slate-800">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Add any notes for the supplier before approval..."
          />
          <button
            onClick={saveDraft}
            disabled={saving}
            className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      ) : po.notes ? (
        <div className="panel p-4">
          <h4 className="mb-1 font-semibold text-slate-800">Notes</h4>
          <p className="text-sm text-slate-600">{po.notes}</p>
        </div>
      ) : null}

      <div className="panel flex flex-wrap items-center justify-between gap-4 p-4">
        {/* C39 fix: the export endpoint now returns a real PDF with
            Content-Disposition: attachment (see export/route.ts), so the
            browser downloads it directly — target="_blank" is no longer
            needed and previously contributed to this always opening a new
            tab instead of downloading. */}
        <a
          href={`${po.exportUrl}?format=pdf`}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Download PO (PDF)
        </a>

        {isDraft ? (
          showOtp ? (
            <div className="w-full max-w-sm space-y-2 rounded-lg border border-slate-200 p-3">
              {!otpSent ? (
                // C37 fix: no OTP input is shown until a real OTP has
                // actually been requested/sent — the previous implementation
                // let the user type any 6-digit number here with nothing
                // ever sent.
                <>
                  <p className="text-xs text-slate-500">
                    Approving this PO requires a one-time OTP for digital approval. Click below to send it to your
                    registered mobile/email.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={sendOtp}
                      disabled={sendingOtp}
                      className="flex-1 rounded-md bg-[color:var(--posh-primary)] px-3 py-2 text-sm font-semibold text-[color:var(--posh-primary-fg)] disabled:opacity-60"
                    >
                      {sendingOtp ? "Sending OTP..." : "Send OTP"}
                    </button>
                    <button
                      onClick={() => setShowOtp(false)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500">
                    {otpDeliveryMessage || "Enter the 6-digit OTP sent to approve and issue this PO."}
                  </p>
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="6-digit OTP"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tracking-widest"
                  />
                  <input
                    type="text"
                    value={approverName}
                    onChange={(e) => setApproverName(e.target.value)}
                    placeholder="Approver name (optional)"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    value={approverDesignation}
                    onChange={(e) => setApproverDesignation(e.target.value)}
                    placeholder="Designation (optional)"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={approve}
                      disabled={approving || otp.length !== 6}
                      className="flex-1 rounded-md bg-[color:var(--posh-primary)] px-3 py-2 text-sm font-semibold text-[color:var(--posh-primary-fg)] disabled:opacity-60"
                    >
                      {approving ? "Approving..." : "Confirm & Issue PO"}
                    </button>
                    <button
                      onClick={sendOtp}
                      disabled={sendingOtp}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      {sendingOtp ? "Resending..." : "Resend OTP"}
                    </button>
                    <button
                      onClick={() => {
                        setShowOtp(false);
                        setOtpSent(false);
                        setOtp("");
                        setOtpDeliveryMessage(null);
                      }}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowOtp(true)}
              className="posh-btn-solid rounded-md px-4 py-2 text-sm font-semibold"
            >
              Approve & Issue PO
            </button>
          )
        ) : (
          <p className="text-sm text-slate-500">
            {po.status === "ISSUED"
              ? "Shared with supplier — awaiting acknowledgement."
              : po.status === "ACKNOWLEDGED"
              ? "Supplier has acknowledged this PO."
              : "PO fulfilled."}
          </p>
        )}
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}
