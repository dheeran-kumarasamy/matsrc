import Link from "next/link";
import { notFound } from "next/navigation";
import { builderApiGet, ApiError } from "@/lib/api";

import OrderTimeline from "@/components/orders/OrderTimeline";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import SupplierSocialProof from "@/components/products/SupplierSocialProof";
import OrderRatingForm from "@/components/orders/OrderRatingForm";
import GeneratePoButton from "@/components/orders/GeneratePoButton";
import OrderSiteAssignment from "@/components/orders/OrderSiteAssignment";


type OrderDetail = {
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
  siteId?: string | null;
  siteName?: string;

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

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  let order: OrderDetail | null = null;
  let loadError = false;

  try {
    order = await builderApiGet<OrderDetail>(`/orders/${params.id}`);
  } catch (error) {
    // Only a genuine 404 from the API (order doesn't exist / doesn't belong
    // to this builder) should render Next's not-found page. Any other
    // failure (auth/session timing, transient 5xx, network blip) should show
    // a retryable error state instead of a permanent-looking 404 — this was
    // the root cause of "clicking enquiry button shows 404 page" even for
    // orders that do exist.
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    loadError = true;
  }

  if (loadError) {
    return (
      <div className="posh-body mx-auto max-w-4xl">
        <div className="posh-card space-y-3 p-10 text-center">
          <p className="posh-card-title">Could not load this order right now.</p>
          <p className="posh-muted text-sm">Please try again in a moment.</p>
          <Link href={`/orders/${params.id}`} className="posh-btn inline-block">
            Retry
          </Link>
        </div>
      </div>
    );
  }

  if (!order) {
    notFound();
  }


  return (
    <div className="posh-body mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="posh-eyebrow">My Orders</p>
          <h1 className="posh-page-title mt-2">Order #{order.id.slice(0, 8)}</h1>
          <p className="posh-subtitle mt-2">
            {order.supplierName} · Delivery: {order.deliveryDate}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <OrderStatusBadge status={order.status} />
          {order.isAggregated ? <span className="posh-status">Group Order</span> : null}
          {order.paymentLinkAvailable ? (
            <Link href={order.paymentLink} className="posh-btn">
              Open payment link
            </Link>
          ) : null}
        </div>
      </header>

      {order.status === "PROCESSING" ? (
        <div className="rounded-2xl border border-black/15 bg-black/[0.03] px-4 py-3 text-sm font-medium text-black/70">
          Supplier confirmed this enquiry. WhatsApp and in-app updates will continue as the order moves forward.
        </div>
      ) : null}

      {order.status === "PROCESSING" && order.primaryListingId && order.supplierId ? (
        <SupplierSocialProof
          listingId={order.primaryListingId}
          supplierId={order.supplierId}
          acceptedContext
        />
      ) : null}

      {order.status === "CANCELLED" ? (
        <div className="rounded-2xl border border-black bg-white px-4 py-3 text-sm font-bold text-black">
          Supplier declined this enquiry. You can review the details and place a fresh order if needed.
        </div>
      ) : null}

      {order.isAggregated ? (
        <div className="rounded-2xl border border-black/15 bg-black/[0.03] px-4 py-3 text-sm text-black">
          <p className="posh-card-title text-base">This is a Group &amp; Save order</p>
          <p className="mt-1 font-medium text-black/70">
            {order.poolLocked
              ? `Pool locked${order.priceAfterAggregation ? ` at INR ${order.priceAfterAggregation.toLocaleString("en-IN")}/unit` : ""}. This order will now proceed through the standard fulfilment stages below.`
              : "This order is still pooling with other builders to unlock a better price. It will convert once the pool locks."}
          </p>
          {order.priceBeforeAggregation && order.priceAfterAggregation && order.priceBeforeAggregation > order.priceAfterAggregation ? (
            <p className="mt-2 text-xs font-bold text-black">
              You saved INR {(order.priceBeforeAggregation - order.priceAfterAggregation).toLocaleString("en-IN")}/unit
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Digital Purchase Order — additive layer on top of existing enquiry/order tracking */}

      {order.quoteAccepted ? (
        <div className="posh-card space-y-3 p-6">
          <h2 className="posh-card-title">Purchase Order</h2>
          {order.purchaseOrder ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-black/70">
                {order.purchaseOrder.poNumber}
                {order.purchaseOrder.version > 1 ? ` (v${order.purchaseOrder.version})` : ""} ·{" "}
                <span className="font-bold text-black">{order.purchaseOrder.status}</span>
              </p>
              <Link href={`/purchase-orders/${order.purchaseOrder.id}`} className="posh-btn-ghost">
                View Purchase Order
              </Link>
            </div>
          ) : (
            <GeneratePoButton orderId={order.id} />
          )}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_0.9fr]">
        <section className="posh-card space-y-4 p-6">
          <div>
            <h2 className="posh-card-title">Enquiry items</h2>
            <p className="posh-subtitle mt-1">This order starts as a supplier enquiry and becomes payable after supplier confirmation.</p>
          </div>
          <div className="divide-y divide-black/10 rounded-xl border border-black/10">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-bold text-black">{item.name}</p>
                  <p className="posh-label mt-1">
                    {item.quantity} {item.unit} · INR {item.unitPrice.toLocaleString("en-IN")}/unit
                  </p>
                </div>
                <p className="font-bold text-black">INR {(item.quantity * item.unitPrice).toLocaleString("en-IN")}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm">
            <span className="posh-label">Total</span>
            <span className="text-base font-bold text-black">INR {order.total.toLocaleString("en-IN")}</span>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="posh-card p-6">
            <h2 className="posh-card-title">Status timeline</h2>
            <div className="mt-4">
              <OrderTimeline status={order.status} isAggregated={order.isAggregated} poolLocked={order.poolLocked} />

            </div>
          </div>

          <div className="posh-card space-y-3 p-6">
            <h2 className="posh-card-title">Payment</h2>
            <p className="posh-subtitle">
              {order.status === "CANCELLED"
                ? "This enquiry was declined, so payment is not available."
                : order.paymentLinkAvailable
                ? "Supplier has confirmed this enquiry. The payment link is now enabled."
                : "Waiting for supplier confirmation before payment becomes available."}
            </p>
            <div className="rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm font-medium text-black/70">
              Payment status: <span className="font-bold text-black">{order.paymentStatus}</span>
            </div>
            {order.paymentLinkAvailable ? (
              <Link href={order.paymentLink} className="posh-btn block text-center">
                Open payment link
              </Link>
            ) : null}
          </div>

          {order.status === "DELIVERED" ? <OrderRatingForm orderId={order.id} /> : null}
        </aside>
      </div>
    </div>
  );
}
