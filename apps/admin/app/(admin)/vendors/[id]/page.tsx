type Props = {
  params: { id: string };
};

import { adminApiGet } from "@/lib/api";
import { VendorDecisionActions } from "@/components/admin/VendorDecisionActions";

export default async function VendorReviewPage({ params }: Props) {
  const vendor = await adminApiGet<{
    id: string;
    name: string | null;
    supplierProfile: { companyName: string } | null;
    kycDocuments: Array<{ id: string; type: string; fileUrl: string }>;
  }>(`/admin/vendors/${params.id}`).catch(() => null);

  const documents = vendor?.kycDocuments || [];

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-950">Vendor Review #{params.id}</h3>
        <p className="mt-1 text-sm text-slate-600">{vendor?.supplierProfile?.companyName || vendor?.name || "Unknown Vendor"} · Supplier</p>
        <div className="mt-4 space-y-3">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm font-semibold text-slate-800">{doc.type}</span>
              <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">Open</a>
            </div>
          ))}
        </div>
      </section>
      <aside className="panel p-5">
        <h4 className="text-lg font-bold text-slate-950">Decision</h4>
        <VendorDecisionActions vendorId={params.id} />
      </aside>
    </div>
  );
}