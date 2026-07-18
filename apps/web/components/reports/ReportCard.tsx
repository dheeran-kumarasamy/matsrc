"use client";

import { useState } from "react";
import { builderApiGet } from "@/lib/api";
import type { ReportDefinition } from "@/lib/reports-types";
import ReportResult from "@/components/reports/ReportResult";

const DATA_SOURCE_STYLES: Record<string, string> = {
  "Account data": "border-blue-200 bg-blue-50 text-blue-700",
  "Live feed": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Historical data": "border-amber-200 bg-amber-50 text-amber-700",
  "AI insight": "border-purple-200 bg-purple-50 text-purple-700",
};

type Props = {
  report: ReportDefinition;
};

// Single report card — shown in a grid inside ReportsOverlay/ReportsBody.
// Available reports (real backing data) get a working "Generate" action that
// fetches from the corresponding /api/builder/reports/* route and renders
// the result inline. Unavailable reports show a disabled "Coming soon"
// state instead of wiring a button to non-existent data (GATING requirement).
export default function ReportCard({ report }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [data, setData] = useState<unknown>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(false);
    try {
      const result = await builderApiGet<unknown>(`/reports/${report.id}`);
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="panel flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{report.title}</h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            DATA_SOURCE_STYLES[report.dataSource] ?? "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          {report.dataSource}
        </span>
      </div>

      <p className="text-xs text-slate-600">{report.description}</p>

      {report.available ? (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="mt-1 rounded-lg bg-blue-700 px-3 py-2 text-center text-sm font-bold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Generating..." : "Generate"}
        </button>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            disabled
            title="Data not yet available for this report"
            className="flex-1 cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-400"
          >
            Generate
          </button>
          <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">
            Coming soon
          </span>
        </div>
      )}

      {error ? (
        <p className="text-xs text-red-500">Could not generate this report. Please try again.</p>
      ) : null}

      {data ? <ReportResult reportId={report.id} data={data} /> : null}
    </article>
  );
}
