import Link from "next/link";
import { notFound } from "next/navigation";
import { builderApiGet } from "@/lib/api";
import GeneratePoButton from "@/components/orders/GeneratePoButton";
import PaymentMethodSelector from "@/components/orders/PaymentMethodSelector";

type OrderPayment = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  paymentStatus: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  paymentMethod: "UPI" | "CARD" | "NET_BANKING" | "COD" | "CREDIT" | "BANK_TRANSFER";
  paymentLinkAvailable: boolean;
  bankGuaranteeAvailable: boolean;
  supplierName: string;
  total: number;
  totalLabel: string;
  quoteAccepted: boolean;
  purchaseOrder: { id: string; poNumber: string; status: string; version: number } | null;
};


export default async function OrderPaymentPage({ params }: { params: { id: string } }) {
  let order: OrderPayment | null = null;

  try {
    order = await builderApiGet<OrderPayment>(`/orders/${params.id}`);
  } catch {
    order = null;
  }

  if (!order) {
    notFound();
  }

  return (
    <div className="posh-body mx-auto max-w-2xl space-y-5">
      <header>
        <p className="posh-eyebrow">Payment Link</p>
        <h1 className="posh-page-title mt-2">Order #{order.id.slice(0, 8)}</h1>
        <p className="posh-subtitle mt-2">{order.supplierName}</p>
      </header>

      <div className="posh-card space-y-4 p-6">
        <div className={`rounded-2xl p-4 text-sm font-medium ${order.status === "CANCELLED" ? "border border-black bg-white text-black" : "border border-black/15 bg-black/[0.03] text-black/70"}`}>
          {order.status === "CANCELLED"
            ? "This enquiry was declined, so payment cannot be completed for this order."
            : order.paymentLinkAvailable
            ? "Payment link is enabled because the supplier confirmed this enquiry."
            : "Payment is not yet enabled for this enquiry."}
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3">
            <p className="posh-label">Payment status</p>
            <p className="mt-1 font-bold text-black">{order.paymentStatus}</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3">
            <p className="posh-label">Enquiry value</p>
            <p className="mt-1 font-bold text-black">INR {order.total.toLocaleString("en-IN")}</p>
          </div>
        </div>

        {/* REQ-10: Standard vs Bank Guarantee payment method selector, gated by
            REQ-09's bank guarantee approval flag. Only editable while payment
            is still pending. */}
        {order.paymentStatus === "PENDING" && order.status !== "CANCELLED" ? (
          <PaymentMethodSelector
            orderId={order.id}
            currentMethod={order.paymentMethod}
            bankGuaranteeAvailable={order.bankGuaranteeAvailable}
          />
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Link href={`/orders/${order.id}`} className="posh-btn-ghost">
            Back to order
          </Link>
          <Link href="/orders" className="posh-btn">
            View all orders
          </Link>
        </div>
      </div>

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
    </div>
  );
}
