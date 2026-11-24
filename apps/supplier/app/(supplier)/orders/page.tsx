export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getSupplierOrders } from "@/lib/supplier-data";
import { OrderDetailButton } from "@/components/supplier/OrderDetailButton";
import { AutoRefresh } from "@/components/supplier/AutoRefresh";

export default async function SupplierOrdersPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const orders = await getSupplierOrders(session.user.email);

  return (
    <section className="panel overflow-hidden">
      <AutoRefresh intervalMs={5000} />
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
            {orders.map((order) => {
              const items =
                order.items && order.items.length > 0
                  ? order.items
                  : [{ id: order.id, material: order.material, brand: order.brand, qty: order.qty }];
              const rowCount = items.length;

              return items.map((item, idx) => (
                <tr
                  key={`${order.id}-${item.id ?? idx}`}
                  className={`hover:bg-slate-50/50 transition-colors ${
                    idx === 0 ? "border-t border-slate-200" : "border-t border-slate-100"
                  }`}
                >
                  {idx === 0 ? (
                    <td rowSpan={rowCount} className="px-4 py-3 align-top font-semibold text-slate-800">
                      <div className="flex flex-col items-start gap-1">
                        <OrderDetailButton
                          orderId={order.id}
                          label={order.displayOrderNumber}
                          className="font-semibold text-blue-700 underline decoration-dotted hover:text-blue-900"
                        />
                        {order.itemsCount > 1 ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
                            {order.itemsCount} Materials
                          </span>
                        ) : null}
                        {order.isAggregated ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            Group Order
                          </span>
                        ) : null}
                      </div>
                    </td>
                  ) : null}

                  {idx === 0 ? (
                    <td rowSpan={rowCount} className="px-4 py-3 align-top font-medium text-slate-700">
                      {order.buyer}
                    </td>
                  ) : null}

                  <td className="px-4 py-3 align-top text-slate-700">
                    <div className="text-sm">
                      {item.brand ? <p className="text-xs font-semibold text-slate-400">{item.brand}</p> : null}
                      <p className="font-medium text-slate-800">{item.material}</p>
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top text-slate-700 whitespace-nowrap">
                    <div className="text-sm">
                      {item.brand ? <p className="text-xs invisible select-none" aria-hidden="true">&nbsp;</p> : null}
                      <p className="font-semibold text-slate-700">{item.qty}</p>
                    </div>
                  </td>

                  {idx === 0 ? (
                    <td rowSpan={rowCount} className="px-4 py-3 align-top">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                        {order.status}
                      </span>
                    </td>
                  ) : null}

                  {idx === 0 ? (
                    <td rowSpan={rowCount} className="px-4 py-3 align-top">
                      <Link
                        href={`/orders/${order.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        View
                      </Link>
                    </td>
                  ) : null}
                </tr>
              ));
            })}
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