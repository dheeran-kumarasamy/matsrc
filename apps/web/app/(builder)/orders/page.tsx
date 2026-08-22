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
//
// In addition to the single-status chip filters above, this page also
// recognises two "virtual" multi-status filters used by the /newdashboard
// Active Orders / Delivered Orders stat cards (dashboard "Active Orders" =
// not Cancelled/Closed/Delivered; "Delivered Orders" = Delivered or Closed).
// These reuse the exact same already-fetched `orders` list and client-side
// filtering as every other status chip here — no new API endpoint, no
// duplicated business logic, no schema change. There is currently no
// separate "Closed" OrderStatus value in the data model (only Aggregation
// Pool / Purchase Order statuses have one), so filtering also checks for a
// literal "CLOSED" string defensively in case that ever changes.
const ACTIVE_STATUS_FILTER = "ACTIVE";
const DELIVERED_OR_CLOSED_STATUS_FILTER = "DELIVERED_CLOSED";

export default async function OrdersPage({ searchParams }: { searchParams: { status?: string | string[] } }) {
  let orders: OrderItem[] = [];
  let apiError = false;

  const rawStatus = Array.isArray(searchParams.status) ? searchParams.status[0] : searchParams.status;
  const normalized = rawStatus?.toUpperCase() ?? "All";
  const isActiveFilter = normalized === ACTIVE_STATUS_FILTER;
  const isDeliveredOrClosedFilter = normalized === DELIVERED_OR_CLOSED_STATUS_FILTER;
  const activeFilter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(normalized)
    ? (normalized as StatusFilter)
    : "All";

  try {
    orders = await builderApiGet<OrderItem[]>("/orders");
  } catch {
    orders = [];
    apiError = true;
  }

  const filtered = isActiveFilter
    ? orders.filter((o) => !["CANCELLED", "CLOSED", "DELIVERED"].includes(o.status))
    : isDeliveredOrClosedFilter
    ? orders.filter((o) => ["DELIVERED", "CLOSED"].includes(o.status))
    : activeFilter === "All"
    ? orders
    : orders.filter((o) => o.status === activeFilter);

  return (
    <div className="posh-body space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="posh-eyebrow">Procurement desk</p>
          <h1 className="posh-page-title mt-2">My Orders</h1>
          <p className="posh-subtitle mt-2 max-w-2xl">
            Track every enquiry from placement through supplier confirmation to delivery.
          </p>
        </div>
        <Link href="/group-orders" className="posh-btn-ghost">
          My Group Orders →
        </Link>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={s === "All" ? "/orders" : `/orders?status=${s}`}
            className={!isActiveFilter && !isDeliveredOrClosedFilter && activeFilter === s ? "posh-chip-active" : "posh-chip"}
          >
            {FILTER_LABELS[s]}
          </Link>
        ))}
        {/* Virtual multi-status chips — reached from the /newdashboard
            Active Orders / Delivered Orders stat cards (see comment above);
            also directly usable here to jump back into either grouping. */}
        <Link href={`/orders?status=${ACTIVE_STATUS_FILTER}`} className={isActiveFilter ? "posh-chip-active" : "posh-chip"}>
          Active
        </Link>
        <Link href={`/orders?status=${DELIVERED_OR_CLOSED_STATUS_FILTER}`} className={isDeliveredOrClosedFilter ? "posh-chip-active" : "posh-chip"}>
          Delivered / Closed
        </Link>
      </div>

      {apiError ? (
        <div className="posh-card p-10 text-center">
          <p className="text-sm font-bold text-[color:var(--posh-fg)]">Could not load orders right now.</p>
          <p className="posh-muted mt-1 text-xs">Please refresh and try again.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="posh-card p-10 text-center">
          <p className="posh-card-title">No orders found</p>
          <Link href="/products" className="posh-link mt-4 inline-block">
            Place your first order →
          </Link>
        </div>
      ) : (
        <div className="posh-card divide-y divide-[color:var(--posh-border)]">
          {filtered.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-base font-bold tracking-tight text-[color:var(--posh-fg)]">Order #{order.id.slice(0, 8)}</p>
                  {order.isAggregated ? <span className="posh-status">Group Order</span> : null}
                </div>
                <p className="mt-1 text-xs font-semibold text-[color:var(--posh-fg-muted)]">
                  {order.supplierName ? `${order.supplierName} · ` : ""}{order.itemCount} items · INR {order.total.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <OrderStatusBadge status={order.status} />

                {order.paymentLinkAvailable && order.paymentLink ? (
                  <Link href={order.paymentLink} className="posh-status-strong">
                    Payment link enabled
                  </Link>
                ) : null}
                <Link href={`/orders/${order.id}`} className="posh-link">
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
