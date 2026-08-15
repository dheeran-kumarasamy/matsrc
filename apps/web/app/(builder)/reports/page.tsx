import ReportsExplorer from "@/components/reports/ReportsExplorer";

// Standalone full page for direct navigation / refresh / shared links —
// mirrors app/(builder)/orders/page.tsx.
//
// Layout adapted from the posh-web-flair reports design: a single grid of
// report-name cards where clicking a name opens the report detail as an
// overlay with a close button. The "Site-wise Report" card is the one
// exception — it redirects to the dedicated /reports/site-wise page (filters,
// charts, CSV/XLSX/PDF and Tally XML export).
//
// The "AI Recommendation: When to Buy" report is not shown here — no
// LLM-backed buy/hold/wait data source is wired for it yet.
export default function ReportsPage() {
  return <ReportsExplorer />;
}
