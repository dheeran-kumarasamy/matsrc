"use client";

import { useState } from "react";
import { adminApiPatch } from "@/lib/api-client";

export type BuyerRow = {
  id: string;
  name: string | null;
  legalName: string | null;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPincode: string | null;
  paymentDueDays: number;
};

export function BuyerCreditTermsManager({ buyers: initialBuyers }: { buyers: BuyerRow[] }) {
  const [buyers, setBuyers] = useState<BuyerRow[]>(initialBuyers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dueDaysInput, setDueDaysInput] = useState<string>("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = buyers.filter((b) => {
    const q = search.toLowerCase();
    return (
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.legalName && b.legalName.toLowerCase().includes(q)) ||
      (b.email && b.email.toLowerCase().includes(q)) ||
      (b.phone && b.phone.includes(q)) ||
      (b.gstin && b.gstin.toLowerCase().includes(q))
    );
  });

  function startEdit(buyer: BuyerRow) {
    setEditingId(buyer.id);
    setDueDaysInput(String(buyer.paymentDueDays ?? 0));
    setError(null);
  }

  async function saveTerms(id: string) {
    const days = parseInt(dueDaysInput, 10);
    if (isNaN(days) || days < 0) {
      setError("Please enter a valid non-negative number of days");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await adminApiPatch<{ id: string; paymentDueDays: number }>(`/admin/buyers/${id}/credit-terms`, {
        paymentDueDays: days,
      });
      setBuyers((prev) =>
        prev.map((b) => (b.id === id ? { ...b, paymentDueDays: res.paymentDueDays } : b))
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update credit terms");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Buyer Payment & Credit Terms</h1>
          <p className="text-xs text-slate-500">
            Configure default payment terms / credit days for buyers. Used to calculate "Payment Due By" on buyer invoices.
          </p>
        </div>
        <input
          type="text"
          placeholder="Search buyers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        />
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Buyer / Company</th>
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold">GSTIN</th>
              <th className="px-4 py-3 font-semibold">Billing Location</th>
              <th className="px-4 py-3 font-semibold">Default Due Terms</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-700">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No buyers found matching your search.
                </td>
              </tr>
            ) : (
              filtered.map((b) => {
                const isEditing = editingId === b.id;
                return (
                  <tr key={b.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{b.legalName || b.name || "Unnamed Buyer"}</div>
                      {b.tradeName ? <div className="text-[11px] text-slate-500">{b.tradeName}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div>{b.email || "—"}</div>
                      <div className="text-[11px] text-slate-500">{b.phone || ""}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">
                      {b.gstin || "URP"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {b.billingCity && b.billingState ? `${b.billingCity}, ${b.billingState}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            value={dueDaysInput}
                            onChange={(e) => setDueDaysInput(e.target.value)}
                            className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs font-semibold focus:border-slate-600 focus:outline-none"
                            autoFocus
                          />
                          <span className="text-[11px] text-slate-500">days</span>
                        </div>
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            b.paymentDueDays > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"
                          }`}
                        >
                          {b.paymentDueDays > 0 ? `${b.paymentDueDays} days credit` : "Immediate (0 days)"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            disabled={saving}
                            onClick={() => void saveTerms(b.id)}
                            className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {saving ? "…" : "Save"}
                          </button>
                          <button
                            disabled={saving}
                            onClick={() => setEditingId(null)}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(b)}
                          className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Edit Terms
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

