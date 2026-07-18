import ReportsOverlay from "@/components/reports/ReportsOverlay";

export const dynamic = "force-dynamic";

// Intercepting route (Next.js "(.)" convention): navigating to /reports from
// anywhere already inside the (builder) route group renders this into the
// @modal parallel slot instead of the real page, so the current page never
// unmounts. Direct load / refresh / shared link still renders the full
// standalone page at app/(builder)/reports/page.tsx (spec 5A).
export default function ReportsOverlayRoute() {
  return <ReportsOverlay />;
}
