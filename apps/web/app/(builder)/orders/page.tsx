import Link from "next/link";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { builderApiGet } from "@/lib/api";

type OrderItem = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  paymentStatus?: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  itemCount: number;
  total: number;
  createdAt: string;
  supplierName?: string;
  paymentLinkAvailable?: boolean;
  paymentLink?: string;
  isAggregated?: boolean;
  aggregationPoolId?: string | null;
};


const STATUS_FILTERS = ["All", "PLACED", "PROCESSING", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_LABELS: Record<string, string> = {
  All: "All",
  PLACED: "Enquiry",
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
    orders = await builderApiGet<OrderItem[]>("/orders");
  } catch {
    orders = [];
    apiError = true;
  }

  const filtered = activeFilter === "All" ? orders : orders.filter((o) => o.status === activeFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">My Orders</h1>
        <Link
          href="/group-orders"
          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          My Group Orders →
        </Link>
      </div>


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
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">Order #{order.id.slice(0, 8)}</p>
                  {order.isAggregated ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Group Order
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {order.supplierName ? `${order.supplierName} · ` : ""}{order.itemCount} items · INR {order.total.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <OrderStatusBadge status={order.status} />

                {order.paymentLinkAvailable && order.paymentLink ? (
                  <Link href={order.paymentLink} className="text-xs rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 hover:bg-emerald-100">
                    Payment link enabled
                  </Link>
                ) : null}
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
