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
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Payment Link</p>
        <h1 className="text-2xl font-bold text-slate-900">Order #{order.id.slice(0, 8)}</h1>
        <p className="mt-1 text-sm text-slate-500">{order.supplierName}</p>
      </div>

      <div className="panel p-6 space-y-4">
        <div className={`rounded-2xl p-4 text-sm ${order.status === "CANCELLED" ? "border border-rose-200 bg-rose-50 text-rose-800" : "border border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {order.status === "CANCELLED"
            ? "This enquiry was declined, so payment cannot be completed for this order."
            : order.paymentLinkAvailable
            ? "Payment link is enabled because the supplier confirmed this enquiry."
            : "Payment is not yet enabled for this enquiry."}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Payment status</p>
            <p className="mt-1 font-semibold text-slate-900">{order.paymentStatus}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Enquiry value</p>
            <p className="mt-1 font-semibold text-slate-900">INR {order.total.toLocaleString("en-IN")}</p>
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
          <Link href={`/orders/${order.id}`} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Back to order
          </Link>
          <Link href="/orders" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
            View all orders
          </Link>
        </div>
      </div>

      {order.quoteAccepted ? (
        <div className="panel space-y-3 p-6">
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
    </div>
  );
}
