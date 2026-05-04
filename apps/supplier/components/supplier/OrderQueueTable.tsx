type SupplierOrder = {
  id: string;
  material: string;
  quantity: string;
  eta: string;
  status: "NEW" | "PACKING" | "IN_TRANSIT";
};

const badgeStyles: Record<SupplierOrder["status"], string> = {
  NEW: "bg-blue-50 text-blue-700",
  PACKING: "bg-amber-50 text-amber-700",
  IN_TRANSIT: "bg-emerald-50 text-emerald-700",
};

export function OrderQueueTable({ orders }: { orders: SupplierOrder[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold text-slate-900">Incoming Order Queue</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Material</th>
              <th className="px-4 py-3 font-semibold">Quantity</th>
              <th className="px-4 py-3 font-semibold">ETA</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">#{order.id}</td>
                <td className="px-4 py-3 text-slate-700">{order.material}</td>
                <td className="px-4 py-3 text-slate-700">{order.quantity}</td>
                <td className="px-4 py-3 text-slate-700">{order.eta}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${badgeStyles[order.status]}`}>{order.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}