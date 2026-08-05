export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  getListingCompetitiveness,
  getCategoryTrendReport,
  getDistrictOpportunityReport,
} from "@/lib/market-intelligence-data";
import { MarketIntelligenceReportView } from "@/components/supplier/MarketIntelligenceReportView";

// Phase 6B — Supplier "Market Intelligence" report page (spec §2, §5, §6).
// Server component fetches all three aggregate-only report data sets once,
// then hands off to a client component for tabs/filters/CSV export
// interactivity. Wrapped defensively so a failure in one report never takes
// down the whole page (spec §13 — error states must never crash dashboard).
export default async function MarketIntelligencePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const results = await Promise.allSettled([
    getListingCompetitiveness(session.user.email),
    getCategoryTrendReport(session.user.email),
    getDistrictOpportunityReport(session.user.email),
  ]);

  const competitiveness = results[0].status === "fulfilled" ? results[0].value : [];
  const categoryTrend = results[1].status === "fulfilled" ? results[1].value : [];
  const districtOpportunity = results[2].status === "fulfilled" ? results[2].value : [];
  const hadError = results.some((r) => r.status === "rejected");

  return (
    <MarketIntelligenceReportView
      competitiveness={competitiveness}
      categoryTrend={categoryTrend}
      districtOpportunity={districtOpportunity}
      hadError={hadError}
    />
  );
}
