"use client";

// Overlay ("quick view") rendering of the Reports catalogue — mirrors
// components/orders/OrdersListOverlay.tsx (spec 5A single-page overlay
// pattern). Rendered via the intercepting route
// app/(builder)/@modal/(.)reports/page.tsx.

import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REPORT_DEFINITIONS } from "@/lib/reports-definitions";
import ReportCard from "@/components/reports/ReportCard";

export default function ReportsOverlay() {
  const router = useRouter();

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
