export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { KpiCard } from "@/components/supplier/KpiCard";
import { OrderQueueTable } from "@/components/supplier/OrderQueueTable";
import { SupplierFabMenu } from "@/components/supplier/SupplierFabMenu";
import { getSupplierDashboardData } from "@/lib/supplier-data";

export default async function SupplierDashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const { kpis, orders } = await getSupplierDashboardData(session.user.email);

  return (
    <div className="space-y-6">
      <h1 className="pt-2 text-center text-5xl font-extrabold tracking-tight text-slate-900">Operational Console</h1>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </section>

      <section>
        <OrderQueueTable orders={orders} />
      </section>

      <SupplierFabMenu />
    </div>
  );
}