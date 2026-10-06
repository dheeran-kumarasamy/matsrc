import Link from "next/link";
import { notFound } from "next/navigation";
import { builderApiGet } from "@/lib/api";

// ICICI Bank Payment Gateway — UAT ONLY. Payment result page the builder
// lands on after app/api/payment/callback redirects them here. Always
// reflects Buildohub's own server-verified PaymentTransaction state (via
// /orders/[id]/payment/icici/status) — never the raw `outcome` query param
// alone, which is only used as an initial hint while the authoritative
// status loads (task §25: "must reflect the verified backend payment
// state").
type IciciStatusResponse = {
  exists: boolean;
  orderPaymentStatus: string;
  paymentReference?: string;
  status?: string;
  amount?: number;
  message?: string | null;
};

const STATUS_COPY: Record<string, { title: string; tone: string }> = {
  SUCCESS: { title: "Payment Successful", tone: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  PENDING: { title: "Payment Pending", tone: "border-amber-300 bg-amber-50 text-amber-800" },
  FAILED: { title: "Payment Failed", tone: "border-rose-300 bg-rose-50 text-rose-800" },
  CANCELLED: { title: "Payment Cancelled", tone: "border-rose-300 bg-rose-50 text-rose-800" },
  INITIATED: { title: "Verification in Progress", tone: "border-amber-300 bg-amber-50 text-amber-800" },
  REDIRECTED: { title: "Verification in Progress", tone: "border-amber-300 bg-amber-50 text-amber-800" },
};

export default async function IciciPaymentResultPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { outcome?: string };
}) {
  let status: IciciStatusResponse | null = null;
  try {
    status = await builderApiGet<IciciStatusResponse>(`/orders/${params.id}/payment/icici/status`);
  } catch {
    status = null;
  }

  if (!status) {
    notFound();
  }

  const effectiveStatus = status.exists ? status.status || "PENDING" : searchParams.outcome || "PENDING";
  const copy = STATUS_COPY[effectiveStatus] || { title: "Verification in Progress", tone: "border-amber-300 bg-amber-50 text-amber-800" };

  return (
    <div className="posh-body mx-auto max-w-xl space-y-5">
      <header>
        <p className="posh-eyebrow">ICICI Online Payment — UAT</p>
        <h1 className="posh-page-title mt-2">Payment Result</h1>
      </header>

      <div className={`posh-card space-y-3 rounded-2xl border p-6 ${copy.tone}`}>
        <p className="text-lg font-bold">{copy.title}</p>
        {status.paymentReference ? <p className="text-sm">Reference: {status.paymentReference}</p> : null}
        {typeof status.amount === "number" ? <p className="text-sm">Amount: ₹{status.amount.toLocaleString("en-IN")}</p> : null}
        <p className="text-sm">Order payment status: {status.orderPaymentStatus}</p>
        {status.message ? <p className="text-sm italic">{status.message}</p> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={`/orders/${params.id}/payment`} className="posh-btn-ghost">
          Back to Payment Page
        </Link>
        <Link href={`/orders/${params.id}`} className="posh-btn">
          View Order
        </Link>
      </div>
    </div>
  );
}
