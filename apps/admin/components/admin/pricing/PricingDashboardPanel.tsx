"use client";

import type { PricingDashboardSummary } from "@/lib/pricing-admin-types";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusColor(status: string) {
  switch (status) {
    case "HEALTHY":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "WARNING":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "FAILED":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

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

export function PricingDashboardPanel({ summary }: { summary: PricingDashboardSummary | null }) {
  if (!summary) {
    return (
      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Price Intelligence Dashboard</h3>
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
          Unable to load dashboard summary right now. Try refreshing the page.
        </p>
      </section>
    );
  }

  const { platformHealth, processingSummary, observationTrend, pipelineStatus } = summary;

  return (
    <div className="space-y-6">
      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Platform Health</h3>
        <p className="mt-1 text-sm text-slate-600">Last refreshed: {formatDateTime(platformHealth.lastRefreshTime)}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Sources Enabled" value={platformHealth.sourcesEnabled} />
          <MetricCard label="Sources Disabled" value={platformHealth.sourcesDisabled} />
          <MetricCard label="Healthy Sources" value={platformHealth.healthySources} />
          <MetricCard label="Failed Sources" value={platformHealth.failedSources} tone={platformHealth.failedSources > 0 ? "bad" : undefined} />
          <MetricCard label="Active Schedulers" value={platformHealth.activeSchedulers} />
          <MetricCard label="Last Successful Ingestion" value={formatDateTime(platformHealth.lastSuccessfulIngestion)} />
          <MetricCard label="Last Successful Normalization" value={formatDateTime(platformHealth.lastSuccessfulNormalization)} />
          <MetricCard label="Last Successful Rollup" value={formatDateTime(platformHealth.lastSuccessfulRollup)} />
          <MetricCard
            label="Last Failed Ingestion"
            value={formatDateTime(platformHealth.lastFailedIngestion)}
            tone={platformHealth.lastFailedIngestion ? "warn" : undefined}
          />
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Processing Summary</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Raw Observations" value={processingSummary.raw} />
          <MetricCard label="Parsed" value={processingSummary.parsed} />
          <MetricCard label="Normalized" value={processingSummary.normalized} />
          <MetricCard label="Rejected" value={processingSummary.rejected} tone={processingSummary.rejected > 0 ? "warn" : undefined} />
          <MetricCard label="Unmapped" value={processingSummary.unmapped} tone={processingSummary.unmapped > 0 ? "warn" : undefined} />
          <MetricCard label="Quarantined" value={processingSummary.quarantined} tone={processingSummary.quarantined > 0 ? "bad" : undefined} />
          <MetricCard label="Published" value={processingSummary.published} />
          <MetricCard label="Derived" value={processingSummary.derived} />
        </div>

        <h4 className="mt-4 text-sm font-bold text-slate-700">Observation Trend</h4>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <MetricCard label="Last 24 hours" value={observationTrend.last24h} />
          <MetricCard label="Last 7 days" value={observationTrend.last7d} />
          <MetricCard label="Last 30 days" value={observationTrend.last30d} />
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Pipeline Status</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {pipelineStatus.map((stage, idx) => (
            <div key={stage.stage} className="flex items-center gap-2">
              <span className={`rounded-lg border px-3 py-2 text-xs font-bold ${statusColor(stage.status)}`}>
                {stage.stage}
                <span className="ml-2 font-semibold">{stage.status}</span>
              </span>
              {idx < pipelineStatus.length - 1 ? <span className="text-slate-400">→</span> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
