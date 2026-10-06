"use client";

import { useState } from "react";
import { adminApiPatch } from "@/lib/api-client";

// ICICI Bank Payment Gateway — UAT ONLY. Admin read-only list + refund
// action (task §26/§27). NEVER renders secret/credential fields — the
// backend serializer (IciciPaymentsService.serialize) already excludes them.
export type IciciPaymentRow = {
  id: string;
  orderId: string;
  enquiryId: string;
  orderNumber: string | null;
  orderStatus: string;
  paymentReference: string;
  merchantTxnNo: string;
  gateway: string;
  gatewayEnvironment: string;
  amount: number;
  currency: string;
  status: string;
  gatewayTxnId: string | null;
  paymentMode: string | null;
  customer: { id?: string; name: string | null; email: string | null; phone: string | null };
  createdAt: string;
  updatedAt: string;
};

export function IciciPaymentsQueue({ items }: { items: IciciPaymentRow[] }) {
  const [rows, setRows] = useState(items);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refund(row: IciciPaymentRow) {
    if (refunding) return;
    const amountStr = window.prompt(`Refund amount for ${row.paymentReference} (max ₹${row.amount.toLocaleString("en-IN")}):`, String(row.amount));
    if (!amountStr) return;
    const refundAmount = Number(amountStr);
    if (!refundAmount || refundAmount <= 0) {
      setError("Invalid refund amount");
      return;
    }
    setRefunding(row.id);
    setError(null);
    try {
      const updated = await adminApiPatch<IciciPaymentRow>(`/admin/icici-payments/${row.id}/refund`, { refundAmount });
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    } catch (err: any) {
      setError(err?.message || "Refund failed");
    } finally {
      setRefunding(null);
    }
  }

  return (
    <div className="panel space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">ICICI Payments — UAT</h2>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold uppercase text-amber-800">
          Test Environment
        </span>
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No ICICI UAT payment transactions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Payment Ref</th>
                <th className="py-2 pr-4">Merchant Txn No</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Gateway Txn Id</th>
                <th className="py-2 pr-4">Updated</th>
                <th className="py-2 pr-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-semibold">{row.orderNumber ?? row.enquiryId}</td>
                  <td className="py-2 pr-4">{row.paymentReference}</td>
                  <td className="py-2 pr-4">{row.merchantTxnNo}</td>
                  <td className="py-2 pr-4">₹{row.amount.toLocaleString("en-IN")}</td>
                  <td className="py-2 pr-4">{row.status}</td>
                  <td className="py-2 pr-4">{row.gatewayTxnId ?? "—"}</td>
                  <td className="py-2 pr-4">{new Date(row.updatedAt).toLocaleString("en-IN")}</td>
                  <td className="py-2 pr-4">
                    {row.status === "SUCCESS" ? (
                      <button
                        type="button"
                        onClick={() => refund(row)}
                        disabled={refunding === row.id}
                        className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                      >
                        {refunding === row.id ? "Refunding…" : "Refund"}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
