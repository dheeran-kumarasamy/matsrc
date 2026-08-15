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

// Report ids that have no backing data source / are intentionally not shown.
const EXCLUDED_REPORT_IDS = new Set(["ai-buy-recommendation"]);

const VISIBLE_REPORTS: ReportDefinition[] = REPORT_DEFINITIONS.filter(
  (report) => !EXCLUDED_REPORT_IDS.has(report.id) && report.available
);

const DATA_SOURCE_STYLES: Record<string, string> = {
  "Account data": "border-blue-200 bg-blue-50 text-blue-700",
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

  // Fetch the report's real data whenever an overlay is opened.
  useEffect(() => {
    if (!openId) return;
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
    <div className="space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-bold text-slate-900">Reports</h1>
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400 sm:inline">
          Procurement desk
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VISIBLE_REPORTS.map((report) => (
          <button
            key={report.id}
            type="button"
            onClick={() => setOpenId(report.id)}
            className="panel flex flex-col gap-2 p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">{report.title}</h2>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  DATA_SOURCE_STYLES[report.dataSource] ?? "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {report.dataSource}
              </span>
            </div>
            <p className="text-xs text-slate-600">{report.description}</p>
          </button>
        ))}

        {/* Site-wise Report — full page (filters, charts, CSV/XLSX/PDF + Tally
            XML export), so this card navigates instead of opening the overlay. */}
        <button
          type="button"
          onClick={() => router.push("/reports/site-wise")}
          className="flex flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-100 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-bold text-blue-900">Site-wise Report</h2>
            <span className="shrink-0 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              Account data
            </span>
          </div>
          <p className="text-xs text-blue-700">
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
            className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl md:p-8"
          >
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 md:text-xl">{active.title}</h2>
                <p className="mt-1 text-xs text-slate-600">{active.description}</p>
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
                <p className="text-xs text-slate-500">Generating report…</p>
              ) : error ? (
                <p className="text-xs text-red-500">Could not generate this report. Please try again.</p>
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
