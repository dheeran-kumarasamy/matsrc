import Link from "next/link";

const orders = [
  { id: "98214", buyer: "SK Infra Projects", material: "TMT Bars 12mm", qty: "28 MT", status: "NEW" },
  { id: "98211", buyer: "Vinayaka Constructions", material: "OPC Cement 53", qty: "600 Bags", status: "PACKING" },
  { id: "98198", buyer: "Rudra Developers", material: "M Sand", qty: "2 Loads", status: "IN_TRANSIT" },
];

export default function SupplierOrdersPage() {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-xl font-extrabold text-slate-900">Order Fulfilment</h3>
        <p className="text-sm text-slate-600">Accept orders, plan dispatch, and update status in real time.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Buyer</th>
              <th className="px-4 py-3 font-semibold">Material</th>
              <th className="px-4 py-3 font-semibold">Qty</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">#{order.id}</td>
                <td className="px-4 py-3 text-slate-700">{order.buyer}</td>
                <td className="px-4 py-3 text-slate-700">{order.material}</td>
                <td className="px-4 py-3 text-slate-700">{order.qty}</td>
                <td className="px-4 py-3 text-slate-700">{order.status}</td>
                <td className="px-4 py-3">
                  <Link href={`/orders/${order.id}`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}