export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { RfqCard } from "@/components/supplier/RfqCard";
import { QuoteResponseForm } from "@/components/supplier/QuoteResponseForm";
import { getSupplierRfqs, type SupplierRfqCard } from "@/lib/supplier-data";
import { getRfqMarketGuidance } from "@/lib/market-intelligence-data";

export default async function SupplierRfqsPage({ searchParams }: { searchParams?: { respond?: string } }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const rfqs = await getSupplierRfqs(session.user.email);

  // Phase 6B — RFQ Quote Assist (spec §7): fetch read-only, aggregate-only
  // market guidance per RFQ material. Best-effort — a failure for one RFQ
  // must never break the page or the other RFQ cards.
  const guidanceByRfqId = new Map<string, Awaited<ReturnType<typeof getRfqMarketGuidance>>>();
  await Promise.all(
    rfqs.map(async (rfq) => {
      try {
        const guidance = await getRfqMarketGuidance(rfq.material);
        guidanceByRfqId.set(rfq.id, guidance);
      } catch (error) {
        console.error(`Failed to load RFQ market guidance for ${rfq.id}:`, error);
        guidanceByRfqId.set(rfq.id, null);
      }
    })
  );

  return (
    <section className="space-y-3">
      <div className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-900">Open RFQs</h3>
        <p className="text-sm text-slate-600">Respond quickly to improve ranking in builder procurement decisions.</p>
      </div>
      <QuoteResponseForm rfqId={searchParams?.respond ?? null} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rfqs.map((rfq: SupplierRfqCard) => (
          <RfqCard key={rfq.id} rfq={rfq} marketGuidance={guidanceByRfqId.get(rfq.id) ?? null} />
        ))}
      </div>
    </section>
  );
}
