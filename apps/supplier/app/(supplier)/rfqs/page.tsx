export const dynamic = "force-dynamic";

import { RfqCard } from "@/components/supplier/RfqCard";
import { QuoteResponseForm } from "@/components/supplier/QuoteResponseForm";
import { getSupplierRfqs, type SupplierRfqCard } from "@/lib/supplier-data";

export default async function SupplierRfqsPage({ searchParams }: { searchParams?: { respond?: string } }) {
  const rfqs = await getSupplierRfqs();

  return (
    <section className="space-y-3">
      <div className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-900">Open RFQs</h3>
        <p className="text-sm text-slate-600">Respond quickly to improve ranking in builder procurement decisions.</p>
      </div>
      <QuoteResponseForm rfqId={searchParams?.respond ?? null} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rfqs.map((rfq: SupplierRfqCard) => (
          <RfqCard key={rfq.id} rfq={rfq} />
        ))}
      </div>
    </section>
  );
}