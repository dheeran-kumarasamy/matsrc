"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { builderApiPatch, builderApiPost } from "@/lib/api";

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
  supplier: { id: string; companyName: string };
  builder: { id: string; name: string; email: string };
  lineItems: PurchaseOrderLineItem[];
  total: number;
  exportUrl: string;
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  ISSUED: "bg-amber-50 text-amber-700 border-amber-200",
  ACKNOWLEDGED: "bg-blue-50 text-blue-700 border-blue-200",
  FULFILLED: "bg-green-50 text-green-700 border-green-200",
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

  const isDraft = po.status === "DRAFT";

  function updateQuantity(id: string, quantity: number) {
    setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, quantity } : li)));
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
        lineItems: lineItems.map((li) => ({
          id: li.id,
          quantity: li.quantity,
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
      router.refresh();
    } catch (err: any) {
      setError("Approval failed. Check the OTP and try again.");
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
        <div className="panel border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
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
              Adjust quantity/delivery date within supplier-allowed limits before approval.
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
                    {isDraft ? (
                      <input
                        type="number"
                        min={1}
                        value={li.quantity}
                        onChange={(e) => updateQuantity(li.id, Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="text-slate-700">
                        {li.quantity} {li.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-700">INR {li.unitPrice.toLocaleString("en-IN")}</td>
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
                    INR {(li.unitPrice * li.quantity + li.tax).toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <span className="text-sm text-slate-500">Total</span>
          <span className="text-lg font-extrabold text-slate-900">INR {po.total.toLocaleString("en-IN")}</span>
        </div>
      </div>

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
        <a
          href={po.exportUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Download PO (PDF/JSON)
        </a>

        {isDraft ? (
          showOtp ? (
            <div className="w-full max-w-sm space-y-2 rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">
                Enter the 6-digit OTP sent to your registered mobile/email to digitally approve and issue this PO.
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
                  className="flex-1 rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {approving ? "Approving..." : "Confirm & Issue PO"}
                </button>
                <button
                  onClick={() => setShowOtp(false)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowOtp(true)}
              className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
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
