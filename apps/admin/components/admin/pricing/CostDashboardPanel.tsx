"use client";

import type { PricingCostSummary } from "@/lib/pricing-admin-types";

function usd(value: number) {
  return `$${value.toFixed(2)}`;
}

function budgetColor(level: string) {
  switch (level) {
    case "CRITICAL":
      return "border-red-300 bg-red-50 text-red-700";
    case "HIGH":
      return "border-amber-300 bg-amber-50 text-amber-700";
    case "MEDIUM":
      return "border-amber-200 bg-amber-50 text-amber-600";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
}

function toCsv(summary: PricingCostSummary) {
  const header = ["Source", "Cost (30d)", "Cost / Endpoint"];
  const rows = summary.costPerSource.map((source) => [
    source.sourceName,
    source.costLast30d.toFixed(2),
    source.costPerEndpoint.toFixed(2),
  ]);
  const summaryRows = [
    ["Spend Today", summary.spendToday.toFixed(2)],
    ["Spend This Week", summary.spendWeek.toFixed(2)],
    ["Spend This Month", summary.spendMonth.toFixed(2)],
    ["Projected Month", summary.projectedMonth.toFixed(2)],
    ["Cost Per Observation", summary.costPerObservation.toFixed(2)],
    ["Monthly Budget", summary.monthlyBudgetUsd.toFixed(2)],
    ["Budget Remaining", summary.budgetRemaining.toFixed(2)],
    ["Budget Used %", summary.budgetUsedPct.toFixed(1)],
  ];
  return [
    ["Metric", "Value"],
    ...summaryRows,
    [],
    header,
    ...rows,
  ]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function CostDashboardPanel({ summary }: { summary: PricingCostSummary | null }) {
  if (!summary) {
    return (
      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Cost Dashboard</h3>
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
          Unable to load cost summary right now. Try refreshing the page.
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
    link.download = "cost-dashboard.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-950">Cost Dashboard</h3>
        <button
          type="button"
          onClick={handleExportCsv}
          aria-label="Export cost dashboard as CSV"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Figures are computed from recorded Apify scrape run costs (PricingScrapeRun.costUsd) — this is not a live Apify billing API
        integration.
      </p>

      <div
        className={`mt-3 rounded-xl border p-4 text-sm font-semibold ${budgetColor(summary.budgetWarningLevel)}`}
      >
        Budget usage: {summary.budgetUsedPct.toFixed(1)}% of ${summary.monthlyBudgetUsd.toFixed(2)} monthly budget (
        {summary.budgetWarningLevel}). Remaining: {usd(summary.budgetRemaining)}.{" "}
        {summary.budgetWarningLevel === "OK" ? null : "Threshold warning triggered."}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spend Today</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{usd(summary.spendToday)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spend This Week</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{usd(summary.spendWeek)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spend This Month</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{usd(summary.spendMonth)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Projected Month</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{usd(summary.projectedMonth)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cost per Observation</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{usd(summary.costPerObservation)}</p>
        </div>
      </div>

      <div className="mt-4">
        <h4 className="text-sm font-bold text-slate-700">Cost Per Source (last 30 days)</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="p-2">Source</th>
                <th className="p-2">Cost (30d)</th>
                <th className="p-2">Cost / Endpoint</th>
              </tr>
            </thead>
            <tbody>
              {summary.costPerSource.map((source) => (
                <tr key={source.sourceId}>
                  <td className="p-2 font-semibold text-slate-800">{source.sourceName}</td>
                  <td className="p-2">{usd(source.costLast30d)}</td>
                  <td className="p-2">{usd(source.costPerEndpoint)}</td>
                </tr>
              ))}
              {summary.costPerSource.length === 0 ? (
                <tr>
                  <td className="p-2 text-slate-500" colSpan={3}>
                    No cost data available yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4">
        <h4 className="text-sm font-bold text-slate-700">Cost Trend (last 30 days)</h4>
        {summary.costTrend.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No trend data available yet.</p>
        ) : (
          <div className="mt-2 flex items-end gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2" style={{ height: 80 }}>
            {(() => {
              const max = Math.max(...summary.costTrend.map((d) => d.cost), 0.01);
              return summary.costTrend.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${usd(d.cost)}`}
                  className="w-2 flex-shrink-0 rounded-t bg-sky-400"
                  style={{ height: `${Math.max((d.cost / max) * 100, 2)}%` }}
                />
              ));
            })()}
          </div>
        )}
      </div>
    </section>
  );
}
