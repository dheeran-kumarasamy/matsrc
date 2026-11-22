import Link from "next/link";
import { notFound } from "next/navigation";
import { adminApiGet } from "@/lib/api";
import { requireAdminAccess } from "@/lib/rbac";
import { AdminQuotationReview, type AdminQuotationData } from "@/components/admin/AdminQuotationReview";
import { AdminConfirmDeliveryButton } from "@/components/admin/AdminConfirmDeliveryButton";

type RfqSummary = {
  id: string;
  rfqNumber: string;
  status: string;
  createdAt: string;
  builder: { name: string | null; email: string | null; phone: string | null } | null;
  itemCount: number;
};

// Admin RFQ & Quotation Management page:
// Allows Admin to view builder enquiry details, download RFQ PDF,
// and review incoming supplier quotations with markup customization
// before deciding what and when to release to the buyer.
export default async function AdminRfqDetailPage({ params }: { params: { orderId: string } }) {
  await requireAdminAccess();

  let rfq: RfqSummary | null = null;
  let quotationData: AdminQuotationData | null = null;

  try {
    const [rfqRes, quotesRes] = await Promise.all([
      adminApiGet<RfqSummary>(`/admin/orders/${params.orderId}/rfq`),
      adminApiGet<AdminQuotationData>(`/admin/orders/${params.orderId}/quotes`).catch(() => null),
    ]);
    rfq = rfqRes;
    quotationData = quotesRes;
  } catch {
    notFound();
  }

  if (!rfq) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">RFQ / Enquiry</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">#{rfq.rfqNumber}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {new Date(rfq.createdAt).toLocaleDateString("en-IN")} · Status: <span className="font-semibold text-slate-900">{rfq.status}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/admin/orders/${params.orderId}/rfq-pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
          >
            Download RFQ PDF
          </a>
          <Link
            href={`/orders/${params.orderId}/invoice`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            View Invoice
          </Link>
          <a
            href={`/api/admin/orders/${params.orderId}/delivery-challan/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Download Delivery Challan
          </a>
          {rfq.status === "DISPATCHED" ? (
            <AdminConfirmDeliveryButton orderId={params.orderId} />
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-slate-950">Buyer Information</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
          <div>
            <span className="text-xs text-slate-500">Name</span>
            <p className="font-medium text-slate-800">{rfq.builder?.name || "Builder"}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Contact</span>
            <p className="font-medium text-slate-800">
              {[rfq.builder?.email, rfq.builder?.phone].filter(Boolean).join(" · ") || "No contact on file"}
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Requested Items</span>
            <p className="font-medium text-slate-800">{rfq.itemCount} item(s)</p>
          </div>
        </div>
      </section>

      {quotationData && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <AdminQuotationReview initialData={quotationData} />
        </section>
      )}
    </div>
  );
}
