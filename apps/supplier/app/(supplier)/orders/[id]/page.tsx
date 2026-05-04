type Props = {
  params: { id: string };
};

const timeline = ["Order Accepted", "Material Allocated", "Truck Assigned", "Out for Delivery", "Delivered"];

export default function SupplierOrderDetailPage({ params }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-900">Order #{params.id}</h3>
        <p className="mt-1 text-sm text-slate-600">Buyer: SK Infra Projects | Delivery: 600102</p>

        <div className="mt-4 space-y-3">
          {timeline.map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${i <= 2 ? "bg-blue-600" : "bg-slate-300"}`} />
              <p className="text-sm font-semibold text-slate-700">{step}</p>
            </div>
          ))}
        </div>
      </section>

      <aside className="panel p-5">
        <h4 className="text-lg font-bold text-slate-900">Update Status</h4>
        <div className="mt-3 space-y-2">
          <button className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Mark as Packed</button>
          <button className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Assign Vehicle</button>
          <button className="w-full rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white">Mark Dispatched</button>
        </div>
      </aside>
    </div>
  );
}