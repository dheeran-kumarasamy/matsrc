import Link from "next/link";
import { notFound } from "next/navigation";
import { adminApiGet } from "@/lib/api";
import { requireAdminAccess } from "@/lib/rbac";

type RfqSummary = {
  id: string;
  rfqNumber: string;
  status: string;
  createdAt: string;
  builder: { name: string | null; email: string | null; phone: string | null } | null;
  itemCount: number;
};

// Minimal Admin RFQ detail page — every Admin/Super Admin may view any RFQ
// (no per-order ownership scoping needed, same as the existing Admin
// invoice view). Exists specifically so "Download RFQ PDF" is available
// independently of invoicing/payment (unlike the pre-existing
// orders/[orderId]/invoice page, which only exists once an invoice has
// been generated after payment approval).
export default async function AdminRfqDetailPage({ params }: { params: { orderId: string } }) {
  await requireAdminAccess();

  let rfq: RfqSummary | null = null;
  try {
    rfq = await adminApiGet<RfqSummary>(`/admin/orders/${params.orderId}/rfq`);
  } catch {
    notFound();
  }

  if (!rfq) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">RFQ / Enquiry</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">#{rfq.rfqNumber}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {new Date(rfq.createdAt).toLocaleDateString("en-IN")} · Status: {rfq.status}
        </p>
      </div>

      <section className="panel space-y-2 p-5">
        <h2 className="text-lg font-bold text-slate-950">Builder</h2>
        <p className="text-sm text-slate-700">{rfq.builder?.name || "Builder"}</p>
        <p className="text-sm text-slate-600">
          {[rfq.builder?.email, rfq.builder?.phone].filter(Boolean).join(" · ") || "No contact on file"}
        </p>
        <p className="text-sm text-slate-600">{rfq.itemCount} item(s)</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/admin/orders/${params.orderId}/rfq-pdf`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
        >
          Download RFQ PDF
        </a>
        <Link
          href={`/orders/${params.orderId}/invoice`}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
        >
          View Invoice
        </Link>
      </div>
    </div>
  );
}
