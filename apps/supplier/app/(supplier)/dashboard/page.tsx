export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SupplierFabMenu } from "@/components/supplier/SupplierFabMenu";
import { MarketScroller } from "@/components/supplier/MarketScroller";
import { DashboardQueueSwitcher } from "@/components/supplier/DashboardQueueSwitcher";
import { getSupplierDashboardData, getMarketScrollerData, getSupplierListings } from "@/lib/supplier-data";

export default async function SupplierDashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const [{ kpis, orders, pendingEnquiries }, scrollerItems, listings] = await Promise.all([
    getSupplierDashboardData(session.user.email),
    getMarketScrollerData(session.user.email),
    getSupplierListings(session.user.email),
  ]);

  return (
    <div className="space-y-6">
      <MarketScroller initialItems={scrollerItems} />

      <DashboardQueueSwitcher kpis={kpis} orders={orders} listings={listings} pendingEnquiries={pendingEnquiries} />

      <SupplierFabMenu />
    </div>
  );
}