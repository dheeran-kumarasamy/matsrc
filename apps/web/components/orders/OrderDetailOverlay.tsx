"use client";

// Overlay ("quick view") rendering of a single order's detail — mirrors
// app/(builder)/orders/[id]/page.tsx but renders inside a Dialog so the
// builder never leaves the page underneath (spec 5A single-page overlay
// pattern). Rendered via the intercepting route
// app/(builder)/@modal/(.)orders/[id]/page.tsx.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OrderTimeline from "@/components/orders/OrderTimeline";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import SupplierSocialProof from "@/components/products/SupplierSocialProof";
import OrderRatingForm from "@/components/orders/OrderRatingForm";
import GeneratePoButton from "@/components/orders/GeneratePoButton";

export type OverlayOrderDetail = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  paymentStatus: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  paymentLinkAvailable: boolean;
  paymentLink: string;
  supplierId: string | null;
  primaryListingId: string | null;
  supplierName: string;
  total: number;
  totalLabel: string;
  deliveryDate: string;
  quoteAccepted?: boolean;
  isAggregated?: boolean;
  aggregationPoolId?: string | null;
  poolLocked?: boolean;
  priceBeforeAggregation?: number | null;
  priceAfterAggregation?: number | null;
  purchaseOrder?: { id: string; poNumber: string; status: string; version: number } | null;
  items: Array<{
    id: string;
    productId: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
  }>;
  tracking: Array<{
    id: string;
    status: string;
    label: string;
    recordedAt: string;
  }>;
};

type Props = {
  order: OverlayOrderDetail;
};

export default function OrderDetailOverlay({ order }: Props) {
  const router = useRouter();

  function handleOpenChange(open: boolean) {
    if (!open) {
      // Overlay close = go back to whatever page never unmounted underneath.
      router.back();
    }
  }

  return (
    <Dialog defaultOpen onOpenChange={handleOpenChange}>
      <DialogContent className="p-0 sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">My Orders</p>
              <DialogTitle>Order #{order.id.slice(0, 8)}</DialogTitle>
              <p className="mt-1 text-sm text-slate-500">
                {order.supplierName} · Delivery: {order.deliveryDate}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <OrderStatusBadge status={order.status} />
              {order.isAggregated ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Group Order
                </span>
              ) : null}
              {order.paymentLinkAvailable ? (
                <Link
                  href={order.paymentLink}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  Open payment link
                </Link>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          {order.status === "PROCESSING" ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Supplier confirmed this enquiry. WhatsApp and in-app updates will continue as the order moves forward.
            </div>
          ) : null}

          {order.status === "PROCESSING" && order.primaryListingId && order.supplierId ? (
            <SupplierSocialProof listingId={order.primaryListingId} supplierId={order.supplierId} acceptedContext />
          ) : null}

          {order.status === "CANCELLED" ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              Supplier declined this enquiry. You can review the details and place a fresh order if needed.
            </div>
          ) : null}

          {order.isAggregated ? (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <p className="font-semibold">This is a Group &amp; Save order</p>
              <p className="mt-1 text-emerald-700">
                {order.poolLocked
                  ? `Pool locked${order.priceAfterAggregation ? ` at INR ${order.priceAfterAggregation.toLocaleString("en-IN")}/unit` : ""}. This order will now proceed through the standard fulfilment stages below.`
                  : "This order is still pooling with other builders to unlock a better price. It will convert once the pool locks."}
              </p>
              {order.priceBeforeAggregation && order.priceAfterAggregation && order.priceBeforeAggregation > order.priceAfterAggregation ? (
                <p className="mt-1 text-xs font-semibold text-emerald-800">
                  You saved INR {(order.priceBeforeAggregation - order.priceAfterAggregation).toLocaleString("en-IN")}/unit
                </p>
              ) : null}
            </div>
          ) : null}

          {order.quoteAccepted ? (
            <div className="panel space-y-3 p-5">
              <h2 className="text-lg font-semibold text-slate-800">Purchase Order</h2>
              {order.purchaseOrder ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">
                    {order.purchaseOrder.poNumber}
                    {order.purchaseOrder.version > 1 ? ` (v${order.purchaseOrder.version})` : ""} ·{" "}
                    <span className="font-semibold">{order.purchaseOrder.status}</span>
                  </p>
                  <Link
                    href={`/purchase-orders/${order.purchaseOrder.id}`}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    View Purchase Order
                  </Link>
                </div>
              ) : (
                <GeneratePoButton orderId={order.id} />
              )}
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[1.5fr_0.9fr]">
            <section className="panel space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Enquiry items</h2>
                <p className="text-sm text-slate-500">
                  This order starts as a supplier enquiry and becomes payable after supplier confirmation.
                </p>
              </div>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-400">
                        {item.quantity} {item.unit} · INR {item.unitPrice.toLocaleString("en-IN")}/unit
                      </p>
                    </div>
                    <p className="font-semibold text-slate-900">
                      INR {(item.quantity * item.unitPrice).toLocaleString("en-IN")}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <span className="font-medium text-slate-600">Total</span>
                <span className="font-bold text-slate-900">INR {order.total.toLocaleString("en-IN")}</span>
              </div>
            </section>

            <aside className="space-y-4">
              <div className="panel p-5">
                <h2 className="text-lg font-semibold text-slate-800">Status timeline</h2>
                <div className="mt-4">
                  <OrderTimeline status={order.status} isAggregated={order.isAggregated} poolLocked={order.poolLocked} />
                </div>
              </div>

              <div className="panel space-y-3 p-5">
                <h2 className="text-lg font-semibold text-slate-800">Payment</h2>
                <p className="text-sm text-slate-500">
                  {order.status === "CANCELLED"
                    ? "This enquiry was declined, so payment is not available."
                    : order.paymentLinkAvailable
                    ? "Supplier has confirmed this enquiry. The payment link is now enabled."
                    : "Waiting for supplier confirmation before payment becomes available."}
                </p>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Payment status: <span className="font-semibold text-slate-900">{order.paymentStatus}</span>
                </div>
                {order.paymentLinkAvailable ? (
                  <Link
                    href={order.paymentLink}
                    className="block rounded-lg bg-blue-700 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    Open payment link
                  </Link>
                ) : null}
              </div>

              {order.status === "DELIVERED" ? <OrderRatingForm orderId={order.id} /> : null}
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
