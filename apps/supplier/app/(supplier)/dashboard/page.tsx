export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { KpiCard } from "@/components/supplier/KpiCard";
import { OrderQueueTable } from "@/components/supplier/OrderQueueTable";
import { getSupplierDashboardData } from "@/lib/supplier-data";

export default async function SupplierDashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const { kpis, orders } = await getSupplierDashboardData(session.user.email);

  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <OrderQueueTable orders={orders} />
        <div className="panel p-4">
          <h3 className="text-lg font-bold text-slate-900">Quick Actions</h3>
          <div className="mt-3 space-y-2">
            <Link href="/listings/new" className="block rounded-lg bg-blue-700 px-3 py-2 text-center text-sm font-bold text-white">
              Add New Listing
            </Link>
            <Link href="/rfqs" className="block rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold text-slate-700">
              Browse RFQs
            </Link>
            <Link href="/onboarding" className="block rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold text-slate-700">
              Complete Onboarding
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}