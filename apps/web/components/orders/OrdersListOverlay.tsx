"use client";

// Overlay ("quick view") rendering of the full orders list — mirrors
// app/(builder)/orders/page.tsx but renders inside a Dialog so the builder
// never leaves the page underneath (spec 5A single-page overlay pattern).
// Rendered via the intercepting route app/(builder)/@modal/(.)orders/page.tsx.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";

export type OverlayOrderItem = {
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

type Props = {
  orders: OverlayOrderItem[];
  apiError: boolean;
};

export default function OrdersListOverlay({ orders, apiError }: Props) {
  const router = useRouter();

  function handleOpenChange(open: boolean) {
    if (!open) {
      // Overlay close = go back to whatever page never unmounted underneath.
      router.back();
    }
  }

  return (
    <Dialog defaultOpen onOpenChange={handleOpenChange}>
      <DialogContent className="p-0 sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>My Orders</DialogTitle>
            <Link
              href="/group-orders"
              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              My Group Orders →
            </Link>
          </div>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {apiError ? (
            <div className="panel p-10 text-center">
              <p className="text-sm text-red-500">Could not load orders right now.</p>
              <p className="mt-1 text-xs text-slate-400">Please refresh and try again.</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="panel p-10 text-center">
              <p className="text-sm text-slate-400">No orders found.</p>
              <Link href="/products" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
                Place your first order →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {orders.map((order) => (
                <div key={order.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">Order #{order.id.slice(0, 8)}</p>
                      {order.isAggregated ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Group Order
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {order.supplierName ? `${order.supplierName} · ` : ""}
                      {order.itemCount} items · INR {order.total.toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <OrderStatusBadge status={order.status} />
                    {order.paymentLinkAvailable && order.paymentLink ? (
                      <Link
                        href={order.paymentLink}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
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
      </DialogContent>
    </Dialog>
  );
}
