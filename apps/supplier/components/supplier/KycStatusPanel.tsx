type KycItem = {
  doc: string;
  status: string;
};

export function KycStatusPanel({ items }: { items: KycItem[] }) {
  return (
    <section className="panel p-5">
      <h3 className="text-xl font-extrabold text-slate-900">KYC Progress</h3>
      <p className="mt-1 text-sm text-slate-600">Complete verification to unlock higher RFQ visibility and credit-backed orders.</p>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.doc} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-sm font-semibold text-slate-800">{item.doc}</span>
            <span
              className={`rounded-full px-2 py-1 text-xs font-bold ${
                item.status === "Verified" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {item.status}
            </span>
          </div>
          ))}
          {items.length === 0 ? <p className="text-sm text-slate-500">No KYC documents uploaded yet.</p> : null}
      </div>
    </section>
  );
}