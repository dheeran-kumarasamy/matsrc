"use client";

// Overlay ("quick view") rendering of the Reports catalogue — mirrors
// components/orders/OrdersListOverlay.tsx (spec 5A single-page overlay
// pattern). Rendered via the intercepting route
// app/(builder)/@modal/(.)reports/page.tsx.
//
// NOTE: This overlay intentionally only surfaces the basic quick-view report
// cards (REPORT_DEFINITIONS). Detailed reports (Site-wise Purchase Report
// with filters/charts/CSV/XLSX/PDF/Tally export) live only on the full
// standalone page at app/(builder)/reports/page.tsx. The "View all detailed
// reports" link below uses a plain <a> (not next/link) so it always forces a
// full browser navigation, guaranteeing it lands on the full page rather
// than being intercepted back into this same overlay.

import { useRouter, usePathname } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REPORT_DEFINITIONS } from "@/lib/reports-definitions";
import ReportCard from "@/components/reports/ReportCard";

export default function ReportsOverlay() {
  const router = useRouter();
  const pathname = usePathname();

  // BUG FIX (dual page opening / linked closure): Next.js keeps the last
  // rendered content of the @modal parallel slot mounted across client-side
  // navigations to routes that don't have their own intercepted @modal
  // page (the slot only resets to default.tsx on a hard navigation). That
  // meant this overlay could stay visibly stacked on top of an unrelated
  // page (e.g. /products) after navigating away from /reports, and its
  // router.back() close handler would then pop history relative to the
  // real stack, redirecting past the page the user actually intended to
  // stay on. Guarding on the live pathname makes this overlay self-close
  // (render nothing) the instant the URL no longer represents /reports.
  if (pathname !== "/reports") {
    return null;
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      // Overlay close = go back to whatever page never unmounted underneath.
      router.back();
    }
  }

  return (
    <Dialog defaultOpen onOpenChange={handleOpenChange}>
      <DialogContent className="p-0 sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Reports</DialogTitle>
            {/* Plain <a> (not next/link): forces a full browser navigation so
                this always lands on the standalone /reports page instead of
                being re-intercepted into this same overlay. */}
            <a
              href="/reports"
              className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              View all detailed reports →
            </a>
          </div>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-y-auto p-5">
          <p className="mb-4 text-xs text-slate-500">
            Quick view of your basic reports. For the Site-wise Purchase Report (filters, charts, and CSV/XLSX/PDF/Tally
            export) and other detailed reports, open the full reports page above.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {REPORT_DEFINITIONS.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
