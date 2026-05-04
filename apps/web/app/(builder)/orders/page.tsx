import Link from "next/link";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";

// UF-04: Order Tracking list — FR-13
export default async function OrdersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">My Orders</h1>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {["All", "Placed", "Processing", "Dispatched", "Delivered"].map((s) => (
          <button key={s} className="text-xs border border-gray-200 rounded-full px-3 py-1 hover:bg-gray-50 transition-colors">
            {s}
          </button>
        ))}
      </div>

      {/* Empty state */}
      <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
        <p className="text-gray-400 text-sm">No orders found.</p>
        <Link href="/products" className="mt-3 inline-block text-sm text-brand-500 hover:underline">
          Place your first order →
        </Link>
      </div>
    </div>
  );
}
