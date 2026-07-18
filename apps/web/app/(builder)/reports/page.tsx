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

      <div className="grid gap-4 sm:grid-cols-2">
        {REPORT_DEFINITIONS.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>
    </div>
  );
}
