"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { builderApiGet, builderApiPatch } from "@/lib/api";

type LedgerMapping = {
  id: string;
  companyName: string;
  purchaseLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
  roundOffLedger: string;
  supplierLedgerMap: Record<string, string>;
  suppliers: { id: string; name: string }[];
};

type DryRunResult = {
  voucherCount: number;
  totalValue: number;
  blockers: { orderId: string; reason: string }[];
};

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function TallySettingsPage() {
  const [mapping, setMapping] = useState<LedgerMapping | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [siteId, setSiteId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await builderApiGet<LedgerMapping>("/tally/ledger-mapping");
      setMapping(data);
    } catch {
      setMapping(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveSettings() {
    if (!mapping) return;
    setSaving(true);
    try {
      await builderApiPatch("/tally/ledger-mapping", {
        companyName: mapping.companyName,
        purchaseLedger: mapping.purchaseLedger,
        cgstLedger: mapping.cgstLedger,
        sgstLedger: mapping.sgstLedger,
        igstLedger: mapping.igstLedger,
        roundOffLedger: mapping.roundOffLedger,
        supplierLedgerMap: mapping.supplierLedgerMap,
      });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  function updateField(field: keyof LedgerMapping, value: string) {
    setMapping((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function updateSupplierLedger(supplierId: string, value: string) {
    setMapping((prev) =>
      prev
        ? { ...prev, supplierLedgerMap: { ...prev.supplierLedgerMap, [supplierId]: value } }
        : prev
    );
  }

  function buildQuery() {
    const params = new URLSearchParams();
    params.set("siteId", siteId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }

  async function handleCheck() {
    setChecking(true);
    setExportError(null);
    try {
      const result = await builderApiGet<DryRunResult>(`/tally/dry-run?${buildQuery()}`);
      setDryRun(result);
    } catch {
      setExportError("Failed to validate export. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  function handleDownload() {
    setExportError(null);
    window.location.href = `/api/builder/tally/export?${buildQuery()}`;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-slate-500">Loading Tally settings…</div>
    );
  }

  if (!mapping) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-red-600">
        Failed to load Tally settings. Please refresh.
      </div>
    );
  }

  return (
    <div className="report-body mx-auto max-w-3xl px-4 py-8">
      <Link href="/reports/site-wise" className="text-[10px] font-bold uppercase tracking-[0.25em] text-[color:var(--posh-primary)] hover:underline">
        ← Back to Site-wise Report
      </Link>
      <h1 className="report-display mt-2 text-4xl text-slate-900 md:text-5xl">Tally Export</h1>
      <p className="mt-2 text-sm font-medium text-slate-600">
        Export your purchases as a Tally-compatible XML file for your accountant to import into
        TallyPrime or Tally.ERP 9. Only <span className="font-medium">paid</span> orders are included
        by default.
      </p>

      {/* Ledger mapping settings */}
      <div className="mt-6 rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
        <h2 className="report-display mb-4 text-xl text-slate-900">Ledger Mapping</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="report-label mb-1.5 block">Tally Company Name</label>
            <input
              value={mapping.companyName}
              onChange={(e) => updateField("companyName", e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="report-label mb-1.5 block">Purchase Ledger</label>
            <input
              value={mapping.purchaseLedger}
              onChange={(e) => updateField("purchaseLedger", e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="report-label mb-1.5 block">CGST Ledger</label>
            <input
              value={mapping.cgstLedger}
              onChange={(e) => updateField("cgstLedger", e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="report-label mb-1.5 block">SGST Ledger</label>
            <input
              value={mapping.sgstLedger}
              onChange={(e) => updateField("sgstLedger", e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="report-label mb-1.5 block">IGST Ledger</label>
            <input
              value={mapping.igstLedger}
              onChange={(e) => updateField("igstLedger", e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="report-label mb-1.5 block">Round Off Ledger</label>
            <input
              value={mapping.roundOffLedger}
              onChange={(e) => updateField("roundOffLedger", e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
        </div>

        {mapping.suppliers.length > 0 ? (
          <div className="mt-4">
            <h3 className="report-label mb-2.5">Supplier → Tally Party Ledger</h3>
            <div className="space-y-2">
              {mapping.suppliers.map((s) => (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-xs font-semibold text-slate-700">{s.name}</span>
                  <input
                    placeholder={s.name}
                    value={mapping.supplierLedgerMap[s.id] ?? ""}
                    onChange={(e) => updateSupplierLedger(s.id, e.target.value)}
                    className="flex-1 rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="posh-btn-solid rounded-full px-5 py-2 text-[10px] font-bold uppercase tracking-[0.18em] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {savedAt ? <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Saved</span> : null}
        </div>
      </div>

      {/* Export */}
      <div className="mt-6 rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
        <h2 className="report-display mb-4 text-xl text-slate-900">Generate Export</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="report-label mb-1.5 block">Site</label>
            <select
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setDryRun(null);
              }}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            >
              <option value="all">All sites</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
          <div>
            <label className="report-label mb-1.5 block">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setDryRun(null);
              }}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="report-label mb-1.5 block">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setDryRun(null);
              }}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="rounded-full border border-slate-200 bg-[color:var(--posh-bg-card)] px-5 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {checking ? "Checking…" : "Validate Export"}
          </button>
          <button
            onClick={handleDownload}
            disabled={!dryRun || dryRun.blockers.length > 0 || dryRun.voucherCount === 0}
            className="posh-btn-solid rounded-full px-5 py-2 text-[10px] font-bold uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Download Tally XML
          </button>
        </div>

        {exportError ? <p className="mt-3 text-xs text-red-600">{exportError}</p> : null}

        {dryRun ? (
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
            <p className="text-slate-700">
              <span className="font-medium">{dryRun.voucherCount}</span> voucher(s) ·{" "}
              <span className="font-medium">{formatCurrency(dryRun.totalValue)}</span> total value
            </p>
            {dryRun.voucherCount === 0 ? (
              <p className="mt-2 text-amber-600">No paid orders match these filters.</p>
            ) : null}
            {dryRun.blockers.length > 0 ? (
              <div className="mt-2 space-y-1">
                {dryRun.blockers.map((b, idx) => (
                  <p key={idx} className="text-red-600">
                    {b.reason}
                  </p>
                ))}
              </div>
            ) : dryRun.voucherCount > 0 ? (
              <p className="mt-2 text-emerald-600">Ready to export.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-4 text-xs text-slate-500">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">How to import into TallyPrime</h2>
        <ol className="list-inside list-decimal space-y-1">
          <li>Open TallyPrime and load your company.</li>
          <li>Go to Gateway of Tally → Import Data → XML.</li>
          <li>Select the downloaded .xml file and confirm the import.</li>
          <li>Purchase Vouchers will appear under Vouchers → Purchase.</li>
        </ol>
      </div>
    </div>
  );
}
