import Link from "next/link";
import { REPORT_DEFINITIONS } from "@/lib/reports-definitions";
import ReportCard from "@/components/reports/ReportCard";

// Standalone full page for direct navigation / refresh / shared links —
// mirrors app/(builder)/orders/page.tsx. When navigated to from within the
// builder layout, the intercepting route at
// app/(builder)/@modal/(.)reports/page.tsx renders this as an overlay
// instead (spec 5A single-page overlay pattern).
export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Reports</h1>

      {/* Site-wise Purchase Report + Tally export — a dedicated full page
          (filters/charts/exports) rather than the inline-generate card
          pattern used by the other reports below. */}
      <Link
        href="/reports/site-wise"
        className="block rounded-xl border border-blue-200 bg-blue-50 p-4 transition-colors hover:bg-blue-100"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-blue-900">Site-wise Purchase Report</h3>
            <p className="mt-1 text-xs text-blue-700">
              Everything purchased through Matsrc, broken down by construction site — with CSV/XLSX/PDF
              export and Tally XML export for your accountant.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-blue-700">
            Account data
          </span>
        </div>
      </Link>

      <div className="grid gap-4 sm:grid-cols-2">
        {REPORT_DEFINITIONS.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>
    </div>
  );
}

