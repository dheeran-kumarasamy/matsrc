"use client";

import axios from "axios";
import { useState } from "react";
import { DetailModal } from "@/components/supplier/DetailModal";

type PurchaseOrderSummary = {
  id: string;
  poNumber: string;
  status: "DRAFT" | "ISSUED" | "ACKNOWLEDGED" | "FULFILLED";
  version: number;
  approvedAt: string | null;
  exportUrl: string;
};

type OrderDetail = {
  id: string;
  buyer: string;
  deliveryDate: string;
  quantity: string;
  material: string;
  status: string;
  tracking: Array<{ id: string; label: string; status: string }>;
  purchaseOrder: PurchaseOrderSummary | null;
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  ISSUED: "bg-amber-50 text-amber-700 border-amber-200",
  ACKNOWLEDGED: "bg-blue-50 text-blue-700 border-blue-200",
  FULFILLED: "bg-green-50 text-green-700 border-green-200",
};

// Shared "View" trigger for Orders and Enquiries (an Enquiry is simply an order in the
// PLACED state) — fetches full order detail (including any issued PO) and renders it
// inside the DetailModal overlay, per UF-04 visibility requirements.
export function OrderDetailButton({
  orderId,
  label = "View",
  className = "rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50",
}: {
  orderId: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  async function openModal() {
    setOpen(true);
    if (detail) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get<OrderDetail>(`/api/supplier/orders/${orderId}`);
      setDetail(data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load order details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        {label}
      </button>

      <DetailModal open={open} onClose={() => setOpen(false)} title={`Order #${orderId}`}>
        {loading ? <p className="text-sm text-slate-500">Loading order details...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Buyer</p>
                <p className="text-slate-800">{detail.buyer}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Status</p>
                <p className="text-slate-800">{detail.status}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Material</p>
                <p className="text-slate-800">{detail.material}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Quantity</p>
                <p className="text-slate-800">{detail.quantity}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Delivery</p>
                <p className="text-slate-800">{detail.deliveryDate}</p>
              </div>
            </div>

            {/* PO number issued by the builder, shown directly inside the overlay + downloadable. */}
            {detail.purchaseOrder ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Purchase Order</p>
                    <p className="text-base font-bold text-slate-900">
                      {detail.purchaseOrder.poNumber}
                      {detail.purchaseOrder.version > 1 ? (
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          v{detail.purchaseOrder.version}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      STATUS_STYLES[detail.purchaseOrder.status] ?? ""
                    }`}
                  >
                    {detail.purchaseOrder.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`${detail.purchaseOrder.exportUrl}?format=pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Download PDF
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">No purchase order has been issued for this order yet.</p>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Tracking</p>
              <div className="space-y-2">
                {detail.tracking.map((step, i) => (
                  <div key={step.id} className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 rounded-full ${
                        i === detail.tracking.length - 1 ? "bg-blue-600" : "bg-slate-300"
                      }`}
                    />
                    <p className="text-sm text-slate-700">{step.label}</p>
                  </div>
                ))}
                {detail.tracking.length === 0 ? (
                  <p className="text-sm text-slate-500">No tracking events recorded yet.</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </DetailModal>
    </>
  );
}
