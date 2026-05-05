import Link from "next/link";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { builderApiGet } from "@/lib/api";

type OrderItem = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  itemCount: number;
  total: number;
  createdAt: string;
};

// UF-04: Order Tracking list — FR-13
export default async function OrdersPage() {
  let orders: OrderItem[] = [];

  try {
    orders = await builderApiGet<OrderItem[]>("/builder/orders");
  } catch {
    orders = [];
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">My Orders</h1>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {["All", "Placed", "Processing", "Dispatched", "Delivered"].map((s) => (
          <button key={s} className="text-xs border border-gray-200 rounded-full px-3 py-1 hover:bg-gray-50 transition-colors">
            {s}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-slate-400 text-sm">No orders found.</p>
          <Link href="/products" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Place your first order →
          </Link>
        </div>
      ) : (
        <div className="panel divide-y divide-slate-100">
          {orders.map((order) => (
            <div key={order.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Order #{order.id.slice(0, 8)}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {order.itemCount} items · INR {order.total.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <OrderStatusBadge status={order.status} />
                <Link href={`/orders/${order.id}`} className="text-xs text-blue-700 hover:underline">
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
