"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Reports explorer — layout adapted from
// github.com/dheeran-kumarasamy/posh-web-flair (src/routes/reports.tsx):
//   • A quiet grid of report-name cards (no inline results, no Generate button)
//   • Clicking a report name opens a single expanding OVERLAY with a close (X)
//     button, Escape-to-close and click-outside-to-close
//   • The "Site-wise Report" card is a navigation card — it redirects to the
//     dedicated /reports/site-wise page instead of opening the overlay
//
// Wiring: each card opens the overlay and fetches its real data from the
// existing /api/builder/reports/<reportId> route via builderApiGet, then
// renders it with the shared ReportResult dispatcher. The
// "AI Recommendation: When to Buy" report is deliberately excluded (no
// backing data source exists for it yet).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { builderApiGet } from "@/lib/api";
import { REPORT_DEFINITIONS } from "@/lib/reports-definitions";
import type { ReportDefinition } from "@/lib/reports-types";
import ReportResult from "@/components/reports/ReportResult";
import { recordReportUsage } from "@/lib/report-usage";

// Report ids that have no backing data source / are intentionally not shown.
const EXCLUDED_REPORT_IDS = new Set(["ai-buy-recommendation"]);

const VISIBLE_REPORTS: ReportDefinition[] = REPORT_DEFINITIONS.filter(
  (report) => !EXCLUDED_REPORT_IDS.has(report.id) && report.available
);

const DATA_SOURCE_STYLES: Record<string, string> = {
  "Account data": "border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.04)] text-[color:var(--posh-primary)]",
  "Live feed": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Historical data": "border-amber-200 bg-amber-50 text-amber-700",
  "AI insight": "border-purple-200 bg-purple-50 text-purple-700",
};

export default function ReportsExplorer() {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const active = VISIBLE_REPORTS.find((report) => report.id === openId) ?? null;

  const close = useCallback(() => {
    setOpenId(null);
    setData(null);
    setError(false);
    setLoading(false);
  }, []);

  // Escape closes the overlay (same behaviour as the posh-web-flair design).
  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, close]);

  // Fetch the report's real data whenever an overlay is opened. Also
  // records this as a real "report opened" event (see lib/report-usage.ts)
  // so the dashboard's Frequently Used Reports panel reflects actual usage.
  useEffect(() => {
    if (!openId) return;
    recordReportUsage(openId);
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    builderApiGet<unknown>(`/reports/${openId}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  return (
    <div className="report-body space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="report-display text-4xl text-slate-900 md:text-5xl">Reports</h1>
        <span className="report-eyebrow hidden sm:inline">
          Procurement desk · {VISIBLE_REPORTS.length + 1} views
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VISIBLE_REPORTS.map((report) => (
          <button
            key={report.id}
            type="button"
            onClick={() => setOpenId(report.id)}
            className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[color:var(--posh-primary)] hover:shadow-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="report-display text-xl text-slate-900">{report.title}</h2>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                  DATA_SOURCE_STYLES[report.dataSource] ?? "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {report.dataSource}
              </span>
            </div>
            <p className="text-xs font-medium leading-relaxed text-slate-600">{report.description}</p>
          </button>
        ))}

        {/* Site-wise Report — full page (filters, charts, CSV/XLSX/PDF + Tally
            XML export), so this card navigates instead of opening the overlay. */}
        <button
          type="button"
          onClick={() => router.push("/reports/site-wise")}
          className="flex flex-col gap-3 rounded-3xl border border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.04)] p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-[rgba(var(--posh-wash-rgb),0.08)] hover:shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="report-display text-xl text-[color:var(--posh-fg)]">Site-wise Report</h2>
            <span className="shrink-0 rounded-full border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--posh-primary)]">
              Account data
            </span>
          </div>
          <p className="text-xs font-medium leading-relaxed text-[color:var(--posh-primary)]">
            Everything purchased through Buildohub, broken down by construction site — with CSV/XLSX/PDF
            export and Tally XML export for your accountant.
          </p>
        </button>
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm md:p-10"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={active.title}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            className="report-body w-full max-w-4xl rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-xl md:p-10"
          >
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="report-display text-3xl text-slate-900 md:text-4xl">{active.title}</h2>
                <p className="mt-2 text-xs font-medium leading-relaxed text-slate-600">{active.description}</p>
              </div>
              <button
                type="button"
                aria-label="Close report"
                onClick={close}
                className="shrink-0 rounded-full border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6">
              {loading ? (
                <p className="report-eyebrow">Generating report…</p>
              ) : error ? (
                <p className="text-xs font-semibold text-red-500">
                  Could not generate this report. Please try again.
                </p>
              ) : data ? (
                <ReportResult reportId={active.id} data={data} />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
