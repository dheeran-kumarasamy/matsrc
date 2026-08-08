"use client";

import type { PricingComplianceSummary } from "@/lib/pricing-admin-types";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function licenseBadge(licenseClass: string) {
  switch (licenseClass) {
    case "PUBLIC_DOMAIN":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "ATTRIBUTION_REQUIRED":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "OWN_DATA":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "INTERNAL_ONLY":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function toCsv(summary: PricingComplianceSummary) {
  const header = [
    "Source",
    "License Class",
    "Public Exposure",
    "Attribution",
    "ToS Reviewed At",
    "Robots Allowed",
    "Enabled",
    "Expired Review",
    "Missing Review",
    "Compliance Risk",
  ];
  const rows = summary.sources.map((source) => [
    source.name,
    source.licenseClass,
    source.publicExposure ? "Yes" : "No",
    source.attribution ?? "",
    source.tosReviewedAt ?? "",
    source.robotsAllowed ? "Allowed" : "Blocked",
    source.isEnabled ? "Enabled" : "Disabled",
    source.expiredReview ? "Yes" : "No",
    source.missingReview ? "Yes" : "No",
    source.complianceRisk ? "Yes" : "No",
  ]);
  return [header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function ComplianceDashboardPanel({ summary }: { summary: PricingComplianceSummary | null }) {
  if (!summary) {
    return (
      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Compliance Dashboard</h3>
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
          Unable to load compliance summary right now. Try refreshing the page.
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
    link.download = "compliance.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-950">Compliance Dashboard</h3>
        <button
          type="button"
          onClick={handleExportCsv}
          aria-label="Export compliance report as CSV"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      {summary.internalOnlyExposureViolations > 0 ? (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
          ⚠ {summary.internalOnlyExposureViolations} published price row(s) may be exposing INTERNAL_ONLY licensed source data
          publicly. This is flagged for investigation — no automatic enforcement has been applied.
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(summary.byLicenseClass).map(([license, count]) => (
          <div key={license} className={`rounded-xl border p-4 ${licenseBadge(license)}`}>
            <p className="text-xs font-semibold uppercase tracking-wide">{license.replace(/_/g, " ")}</p>
            <p className="mt-1 text-2xl font-bold">{count}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expired Review</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{summary.expiredReviewCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing Review</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{summary.missingReviewCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Disabled Sources</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{summary.disabledSourceCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance Risk</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{summary.complianceRiskCount}</p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="p-2">Source</th>
              <th className="p-2">License Class</th>
              <th className="p-2">Public Exposure</th>
              <th className="p-2">Attribution</th>
              <th className="p-2">ToS Reviewed</th>
              <th className="p-2">Robots</th>
              <th className="p-2">Enabled</th>
              <th className="p-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {summary.sources.map((source) => {
              const risky = source.expiredReview || source.missingReview || source.complianceRisk || !source.isEnabled;
              return (
                <tr key={source.id} className={risky ? "bg-red-50/50" : ""}>
                  <td className="p-2 font-semibold text-slate-800">{source.name}</td>
                  <td className="p-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${licenseBadge(source.licenseClass)}`}>
                      {source.licenseClass}
                    </span>
                  </td>
                  <td className="p-2">{source.publicExposure ? "Yes" : "No"}</td>
                  <td className="p-2">{source.attribution ?? "—"}</td>
                  <td className="p-2">{formatDateTime(source.tosReviewedAt)}</td>
                  <td className="p-2">{source.robotsAllowed ? "Allowed" : "Blocked"}</td>
                  <td className="p-2">{source.isEnabled ? "Enabled" : "Disabled"}</td>
                  <td className="p-2 space-x-1">
                    {source.expiredReview ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                        Expired Review
                      </span>
                    ) : null}
                    {source.missingReview ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 border border-red-200">
                        Missing Review
                      </span>
                    ) : null}
                    {source.complianceRisk ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 border border-red-200">
                        Compliance Risk
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
