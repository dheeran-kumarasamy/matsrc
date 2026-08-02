"use client";

// Overlay ("quick view") rendering of the Reports catalogue — mirrors
// components/orders/OrdersListOverlay.tsx (spec 5A single-page overlay
// pattern). Rendered via the intercepting route
// app/(builder)/@modal/(.)reports/page.tsx.

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
          <DialogTitle>Reports</DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-y-auto p-5">
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
