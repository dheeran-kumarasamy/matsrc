"use client";

import type { PricingDataQualitySummary } from "@/lib/pricing-admin-types";

function MetricCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const toneClasses =
    tone === "bad"
      ? "border-red-200 bg-red-50"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50"
        : "border-slate-200 bg-white";
  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
    </div>
  );
}

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function toCsv(summary: PricingDataQualitySummary) {
  const header = ["Metric", "Value"];
  const rows: string[][] = [
    ["Coverage %", pct(summary.coveragePct)],
    ["District Coverage %", pct(summary.districtCoveragePct)],
    ["Category Coverage %", pct(summary.categoryCoveragePct)],
    ["SKU Coverage %", pct(summary.skuCoveragePct)],
    ["Duplicate Rate %", pct(summary.duplicateRatePct)],
    ["Ambiguous Unit Conversions", String(summary.ambiguousUnitConversions)],
    ["Rejected Rows", String(summary.rejectedRows)],
    ["Unmapped %", pct(summary.unmappedPct)],
    ["Derived %", pct(summary.derivedPct)],
    ["Avg Confidence Score", summary.averageConfidenceScore.toFixed(2)],
    ["Stale Sources", String(summary.staleSourceCount)],
    ["Data Age (hrs)", summary.dataAgeHours != null ? summary.dataAgeHours.toFixed(1) : ""],
  ];
  return [header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function DataQualityDashboardPanel({ summary }: { summary: PricingDataQualitySummary | null }) {
  if (!summary) {
    return (
      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Data Quality Dashboard</h3>
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
          Unable to load data quality summary right now. Try refreshing the page.
        </p>
      </section>
    );
  }

  const handleExportCsv = () => {
    const csv = toCsv(summary);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data-quality.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-950">Data Quality Dashboard</h3>
        <button
          type="button"
          onClick={handleExportCsv}
          aria-label="Export data quality metrics as CSV"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard label="Coverage" value={pct(summary.coveragePct)} />
        <MetricCard label="District Coverage" value={pct(summary.districtCoveragePct)} />
        <MetricCard label="Category Coverage" value={pct(summary.categoryCoveragePct)} />
        <MetricCard label="SKU Coverage" value={pct(summary.skuCoveragePct)} />
        <MetricCard label="Duplicate Rate" value={pct(summary.duplicateRatePct)} tone={summary.duplicateRatePct > 5 ? "warn" : undefined} />
        <MetricCard label="Ambiguous Units" value={summary.ambiguousUnitConversions} tone={summary.ambiguousUnitConversions > 0 ? "warn" : undefined} />
        <MetricCard label="Rejected Rows" value={summary.rejectedRows} tone={summary.rejectedRows > 0 ? "warn" : undefined} />
        <MetricCard label="Unmapped %" value={pct(summary.unmappedPct)} tone={summary.unmappedPct > 5 ? "warn" : undefined} />
        <MetricCard label="Derived %" value={pct(summary.derivedPct)} />
        <MetricCard label="Avg Confidence Score" value={summary.averageConfidenceScore.toFixed(2)} />
        <MetricCard label="Stale Sources" value={summary.staleSourceCount} tone={summary.staleSourceCount > 0 ? "bad" : undefined} />
        <MetricCard label="Data Age (hrs)" value={summary.dataAgeHours != null ? summary.dataAgeHours.toFixed(1) : "—"} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4">
          <h4 className="text-sm font-bold text-slate-700">Top Missing Districts</h4>
          {summary.topMissingDistricts.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No missing districts.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {summary.topMissingDistricts.map((d) => (
                <li key={d.code} className="flex justify-between">
                  <span>{d.code}</span>
                  <span className="font-semibold">{d.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <h4 className="text-sm font-bold text-slate-700">Top Missing Categories</h4>
          {summary.topMissingCategories.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No missing categories.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {summary.topMissingCategories.map((c) => (
                <li key={c.code} className="flex justify-between">
                  <span>{c.code}</span>
                  <span className="font-semibold">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <h4 className="text-sm font-bold text-slate-700">Top Missing SKUs</h4>
          {summary.topMissingSkus.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No missing SKUs.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {summary.topMissingSkus.map((s) => (
                <li key={s.id}>{s.code}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        Note: this view shows a point-in-time snapshot. Daily/weekly/monthly trend charts for these metrics are deferred to a future
        batch since they require additional time-series aggregation not yet implemented.
      </p>
    </section>
  );
}
