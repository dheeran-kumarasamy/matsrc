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

const STATUS_FILTERS = ["All", "PLACED", "PROCESSING", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_LABELS: Record<string, string> = {
  All: "All",
  PLACED: "Placed",
  PROCESSING: "Processing",
  DISPATCHED: "Dispatched",
  OUT_FOR_DELIVERY: "Out For Delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

// UF-04: Order Tracking list — FR-13
export default async function OrdersPage({ searchParams }: { searchParams: { status?: string | string[] } }) {
  let orders: OrderItem[] = [];
  let apiError = false;

  const rawStatus = Array.isArray(searchParams.status) ? searchParams.status[0] : searchParams.status;
  const normalized = rawStatus?.toUpperCase() ?? "All";
  const activeFilter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(normalized)
    ? (normalized as StatusFilter)
    : "All";

  try {
    orders = await builderApiGet<OrderItem[]>("/builder/orders");
  } catch {
    orders = [];
    apiError = true;
  }

  const filtered = activeFilter === "All" ? orders : orders.filter((o) => o.status === activeFilter);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">My Orders</h1>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={s === "All" ? "/orders" : `/orders?status=${s}`}
            className={`text-xs border rounded-full px-3 py-1 transition-colors ${
              activeFilter === s
                ? "bg-blue-700 text-white border-blue-700"
                : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            {FILTER_LABELS[s]}
          </Link>
        ))}
      </div>

      {apiError ? (
        <div className="panel p-10 text-center">
          <p className="text-red-500 text-sm">Could not load orders right now.</p>
          <p className="text-slate-400 text-xs mt-1">Please refresh and try again.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-slate-400 text-sm">No orders found.</p>
          <Link href="/products" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Place your first order →
          </Link>
        </div>
      ) : (
        <div className="panel divide-y divide-slate-100">
          {filtered.map((order) => (
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
