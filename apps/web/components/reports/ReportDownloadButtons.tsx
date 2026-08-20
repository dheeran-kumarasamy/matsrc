"use client";

// Shared "Download report" action row — shown under every generated report
// result inside the /reports overlay (ReportResult.tsx), but ONLY once the
// report has actually loaded AND has at least one row. No blank/empty report
// is ever offered for download: each per-report *Result component below
// already early-returns an empty-state message before rendering this, and
// the server-side export route (app/api/builder/reports/[reportId]/export)
// independently re-validates row count and rejects with 400 if empty — so
// the button never produces a genuinely blank file even if this check were
// ever bypassed.
export default function ReportDownloadButtons({ reportId }: { reportId: string }) {
  function exportUrl(format: "xlsx" | "pdf") {
    return `/api/builder/reports/${reportId}/export?format=${format}`;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <a
        href={exportUrl("xlsx")}
        className="rounded-full border border-slate-200 bg-[color:var(--posh-bg-card)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        Download XLSX
      </a>
      <a
        href={exportUrl("pdf")}
        target="_blank"
        rel="noreferrer"
        className="rounded-full border border-slate-200 bg-[color:var(--posh-bg-card)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        Download PDF
      </a>
    </div>
  );
}
