type Props = {
  params: { id: string };
};

const documents = ["GST Certificate", "Trade Licence", "Bank Proof", "PAN", "Factory Photos"];

export default function VendorReviewPage({ params }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-950">Vendor Review #{params.id}</h3>
        <p className="mt-1 text-sm text-slate-600">Arka Steel Traders · Chennai · Steel</p>
        <div className="mt-4 space-y-3">
          {documents.map((doc) => (
            <div key={doc} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm font-semibold text-slate-800">{doc}</span>
              <button className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">Open</button>
            </div>
          ))}
        </div>
      </section>
      <aside className="panel p-5">
        <h4 className="text-lg font-bold text-slate-950">Decision</h4>
        <div className="mt-3 space-y-2">
          <button className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Approve Vendor</button>
          <button className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">Reject Vendor</button>
          <button className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Request Clarification</button>
        </div>
      </aside>
    </div>
  );
}