export const dynamic = "force-dynamic";

import Link from "next/link";
import { getSupplierOrders } from "@/lib/supplier-data";

export default async function SupplierOrdersPage() {
  const orders = await getSupplierOrders();

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
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No supplier orders yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}