import OrderTimeline from "@/components/orders/OrderTimeline";
import GpsMap from "@/components/orders/GpsMap";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import Link from "next/link";

interface Props { params: { id: string } }

// UF-04: Real-time order tracking — FR-13, FR-14
export default async function OrderDetailPage({ params }: Props) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/orders" className="text-xs text-gray-400 hover:text-brand-500">← Orders</Link>
        <h1 className="text-xl font-bold text-gray-900">Order #{params.id}</h1>
        <OrderStatusBadge status="DISPATCHED" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Timeline + items */}
        <div className="lg:col-span-2 space-y-5">
          {/* FR-13: Order status timeline */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-4">Delivery Status</h2>
            <OrderTimeline status="DISPATCHED" />
          </div>

          {/* FR-14: Live GPS map — shown when dispatched */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Live Tracking</h2>
            <GpsMap orderId={params.id} />
          </div>

          {/* Order items */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Items</h2>
            <div className="text-sm text-gray-400">Order items appear here</div>
          </div>
        </div>

        {/* Right: Summary */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
            <h2 className="font-semibold text-gray-800">Order Summary</h2>
            <div className="text-sm space-y-2">
              <div className="flex justify-between text-gray-500"><span>Order ID</span><span className="font-mono text-xs">#{params.id}</span></div>
              <div className="flex justify-between text-gray-500"><span>Payment</span><span>UPI</span></div>
              <div className="flex justify-between text-gray-500"><span>Total</span><span className="font-bold text-gray-800">₹—</span></div>
            </div>
            <button className="w-full text-xs text-brand-500 border border-brand-500 rounded-lg py-2 hover:bg-brand-50 transition-colors">
              Download GST Invoice (PDF)
            </button>
          </div>

          {/* Rate delivery after completion */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-2">Rate Delivery</h2>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} className="text-gray-300 hover:text-yellow-400 text-2xl transition-colors">★</button>
              ))}
            </div>
          </div>

          {/* Raise dispute */}
          <Link href={`/disputes/new?orderId=${params.id}`} className="block text-center text-xs text-red-500 hover:underline">
            Raise a dispute →
          </Link>
        </div>
      </div>
    </div>
  );
}
