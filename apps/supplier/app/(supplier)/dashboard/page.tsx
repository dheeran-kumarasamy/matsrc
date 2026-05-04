import Link from "next/link";
import { KpiCard } from "@/components/supplier/KpiCard";
import { OrderQueueTable } from "@/components/supplier/OrderQueueTable";

const kpis = [
  { label: "Active Listings", value: "24", hint: "+3 this week" },
  { label: "Incoming Orders", value: "8", hint: "2 require dispatch today" },
  { label: "Open RFQs", value: "14", hint: "7 high-priority" },
  { label: "On-time Dispatch", value: "97%", hint: "Last 30 days" },
];

const orders = [
  { id: "98214", material: "TMT Bars Fe500", quantity: "28 MT", eta: "06 May", status: "NEW" as const },
  { id: "98211", material: "OPC Cement 53", quantity: "600 Bags", eta: "05 May", status: "PACKING" as const },
  { id: "98198", material: "M Sand", quantity: "2 Loads", eta: "04 May", status: "IN_TRANSIT" as const },
];

export default function SupplierDashboardPage() {
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