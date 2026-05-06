import OrderTimeline from "@/components/orders/OrderTimeline";
import GpsMap from "@/components/orders/GpsMap";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import Link from "next/link";
import { builderApiGet } from "@/lib/api";

interface Props { params: { id: string } }

type OrderDetail = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  paymentMethod: string;
  paymentStatus: string;
  total: number;
  totalLabel: string;
  deliveryDate: string;
  items: Array<{ id: string; name: string; quantity: number; unit: string; unitPrice: number }>;
  tracking: Array<{ id: string; status: string; label: string; recordedAt: string }>;
};

// UF-04: Real-time order tracking — FR-13, FR-14
export default async function OrderDetailPage({ params }: Props) {
  let order: OrderDetail | null = null;

  try {
    order = await builderApiGet<OrderDetail>(`/builder/orders/${params.id}`);
  } catch {
    order = null;
  }

  if (!order) {
    return (
      <div className="panel p-10 text-center">
        <p className="text-slate-400 text-sm">Order not found.</p>
        <Link href="/orders" className="mt-3 inline-block text-sm text-blue-700 hover:underline">← Back to orders</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/orders" className="text-xs text-slate-400 hover:text-blue-700">← Orders</Link>
        <h1 className="text-xl font-bold text-slate-900">Order #{order.id}</h1>
        <OrderStatusBadge status={order.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Timeline + items */}
        <div className="lg:col-span-2 space-y-5">
          {/* FR-13: Order status timeline */}
          <div className="panel p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Delivery Status</h2>
            <OrderTimeline status={order.status} />
          </div>

          {/* FR-14: Live GPS map — shown when dispatched */}
          {["DISPATCHED", "OUT_FOR_DELIVERY"].includes(order.status) && (
            <div className="panel p-5">
              <h2 className="font-semibold text-slate-800 mb-3">Live Tracking</h2>
              <GpsMap orderId={order.id} />
            </div>
          )}

          {/* Order items */}
          <div className="panel p-5">
            <h2 className="font-semibold text-slate-800 mb-3">Items</h2>
            <div className="divide-y divide-slate-100">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">{item.name}</span>
                  <span className="text-slate-500 text-xs">{item.quantity} {item.unit}</span>
                  <span className="font-semibold text-slate-800">
                    ₹{(item.unitPrice * item.quantity).toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Summary */}
        <div className="space-y-4">
          <div className="panel p-5 space-y-3">
            <h2 className="font-semibold text-slate-800">Order Summary</h2>
            <div className="text-sm space-y-2">
              <div className="flex justify-between text-slate-500"><span>Order ID</span><span className="font-mono text-xs">#{order.id.slice(0, 12)}</span></div>
              <div className="flex justify-between text-slate-500"><span>Payment</span><span>{order.paymentMethod}</span></div>
              <div className="flex justify-between text-slate-500"><span>Delivery By</span><span>{order.deliveryDate}</span></div>
              <div className="flex justify-between font-bold text-slate-800 border-t border-slate-100 pt-2"><span>Total</span><span>{order.totalLabel ?? `₹${order.total?.toLocaleString("en-IN")}`}</span></div>
            </div>
            <button className="w-full text-xs text-blue-700 border border-blue-700 rounded-lg py-2 hover:bg-blue-50 transition-colors">
              Download GST Invoice (PDF)
            </button>
          </div>

          {/* Rate delivery after completion */}
          {order.status === "DELIVERED" && (
            <div className="panel p-5">
              <h2 className="font-semibold text-slate-800 mb-2">Rate Delivery</h2>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} className="text-slate-300 hover:text-yellow-400 text-2xl transition-colors">★</button>
                ))}
              </div>
            </div>
          )}

          {/* Raise dispute */}
          <Link href={`/disputes/new?orderId=${order.id}`} className="block text-center text-xs text-red-500 hover:underline">
            Raise a dispute →
          </Link>
        </div>
      </div>
    </div>
  );
}
