export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SupplierFabMenu } from "@/components/supplier/SupplierFabMenu";
import { MarketScroller } from "@/components/supplier/MarketScroller";
import { DashboardQueueSwitcher } from "@/components/supplier/DashboardQueueSwitcher";
import { AggregationPoolsWidget } from "@/components/supplier/AggregationPoolsWidget";
import { DistrictPricingWidget } from "@/components/supplier/DistrictPricingWidget";
import { MarketIntelligenceSummaryWidget } from "@/components/supplier/MarketIntelligenceSummaryWidget";
import {
  getSupplierDashboardData,
  getMarketScrollerData,
  getSupplierListings,
  getSupplierAggregationPools,
  getSupplierDistrictPricing,
} from "@/lib/supplier-data";
import { getMarketIntelligenceSummary } from "@/lib/market-intelligence-data";

export default async function SupplierDashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const [
    { kpis, orders, pendingEnquiries },
    scrollerItems,
    listings,
    aggregationPools,
    districtPricingRows,
    marketIntelligenceSummary,
  ] = await Promise.all([
    getSupplierDashboardData(session.user.email),
    getMarketScrollerData(session.user.email),
    getSupplierListings(session.user.email),
    getSupplierAggregationPools(session.user.email),
    getSupplierDistrictPricing(session.user.email),
    getMarketIntelligenceSummary(session.user.email),
  ]);

  return (
    <div className="space-y-6">
      <MarketScroller initialItems={scrollerItems} />

      <DashboardQueueSwitcher kpis={kpis} orders={orders} listings={listings} pendingEnquiries={pendingEnquiries} />

      <AggregationPoolsWidget pools={aggregationPools} />

      <DistrictPricingWidget initialRows={districtPricingRows} />

      <MarketIntelligenceSummaryWidget summary={marketIntelligenceSummary} />

      <SupplierFabMenu />
    </div>
  );
}
