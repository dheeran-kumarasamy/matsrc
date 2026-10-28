export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OrderStatusActions } from "@/components/supplier/OrderStatusActions";
import { RfqQuotationForm } from "@/components/supplier/RfqQuotationForm";
import { SupplierInvoiceUpload } from "@/components/supplier/SupplierInvoiceUpload";
import { getSupplierOrderDetail } from "@/lib/supplier-data";

type Props = {
  params: { id: string };
};

type TrackingStep = {
  id: string;
  label: string;
  recordedAt: string;
};

// S11: matches the existing en-IN date/time display convention used
// elsewhere in the app (e.g. apps/admin's formatDateTime helpers) — no new
// timezone system introduced. Dates are stored in UTC (OrderTracking.
// recordedAt) and converted for display using the host runtime's locale
// formatting, consistent with every other formatDateTime in this codebase.
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function SupplierOrderDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const order = await getSupplierOrderDetail(params.id, session.user.email);

  if (!order) {
    return <div className="panel p-5 text-sm text-slate-600">Order not found for this supplier.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-900">Order {order.displayOrderNumber}</h3>
        <p className="mt-1 text-sm text-slate-600">
          Buyer: {order.buyer} | Material: {order.brand ? `${order.brand} ` : ""}
          {order.material} | Delivery: {order.deliveryDate}
        </p>
        <p className="mt-1 text-sm text-slate-600">Site: {order.siteName ?? "Unassigned"}</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">Ask Price: {order.askPrice}</p>

        <div className="mt-3">
          <a
            href={`/api/supplier/orders/${order.id}/rfq-pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"
          >
            Download RFQ PDF
          </a>
        </div>

        {/* Supplier RFQ Price Revision & GST-Inclusive Order Value: while
            this enquiry is still awaiting the supplier's decision (PLACED),
            let the supplier revise the quoted unit price per line item and
            review the GST-inclusive total before confirming. Once the order
            has moved past PLACED, the submitted quotation is final (spec
            §14) — the form is no longer shown.
            Duplicate supplier-action fix: only rendered when this enquiry
            genuinely requires a quotation (a competing-supplier RFQ — see
            getSupplierOrderDetail's hasMultipleEligibleCandidates doc
            comment in lib/supplier-data.ts). For the common single-supplier
            case, OrderStatusActions's "Confirm Enquiry" is the only action
            shown instead, so the two are never rendered together. */}
        {order.status === "PLACED" && order.requiresQuotation ? (
          <div className="mt-4">
            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Quotation</h4>
            <div className="mt-2">
              <RfqQuotationForm enquiryId={order.id} />
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {/* S11: newest activity first — tracking is fetched ascending by
              recordedAt (see getSupplierOrderDetail), so it's reversed here
              for display, per "newest -> oldest" expected ordering. */}
          {[...order.tracking].reverse().map((step: TrackingStep, i: number) => (
            <div key={step.id} className="flex items-start gap-3">
              <div className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${i === 0 ? "bg-blue-600" : "bg-slate-300"}`} />
              <div>
                <p className="text-sm font-semibold text-slate-700">{step.label}</p>
                <p className="text-xs text-slate-400" title={step.recordedAt}>
                  {formatDateTime(step.recordedAt)}
                </p>
              </div>
            </div>
          ))}
          {order.tracking.length === 0 ? <p className="text-sm text-slate-500">No tracking events recorded yet.</p> : null}
        </div>

        {/* Supplier Invoice Upload / Admin Verification workflow: shown
            once the order has moved past the quotation stage (PLACED), so
            the supplier can upload their own invoice for Admin review.
            Uploading here never itself generates the BuildOhub buyer
            invoice — only an Admin's explicit confirmation does that. */}
        {order.status !== "PLACED" ? <SupplierInvoiceUpload orderId={order.id} /> : null}
      </section>

      <OrderStatusActions
        orderId={order.id}
        status={order.status}
        // C34 (UI-level prevention): lets the "Mark Delivered" button be
        // disabled before the supplier ever attempts the action, when the
        // order's payment isn't settled yet. Purely a UX convenience — the
        // server-side guard in updateSupplierOrderStatus (lib/supplier-data.ts)
        // is what actually enforces the rule even if this prop is stale or
        // this check is bypassed entirely.
        paymentStatus={order.paymentStatus}
        // Duplicate supplier-action fix: hides "Confirm Enquiry" when this
        // enquiry genuinely requires a quotation first (RfqQuotationForm
        // above is rendered for that case instead) — see
        // getSupplierOrderDetail's hasMultipleEligibleCandidates doc comment
        // in lib/supplier-data.ts.
        requiresQuotation={order.requiresQuotation}
        // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
        // Dispatch — see getSupplierOrderDetail's dispatchBlockedReason doc
        // comment in lib/supplier-data.ts.
        dispatchBlockedReason={order.dispatchBlockedReason}
        // `label` already mirrors OrderTracking.note verbatim whenever a note
        // was recorded (see getSupplierOrderDetail's `label: entry.note ??
        // humanizeToken(entry.status)`), so it doubles as the `note` input
        // getCancellationActor needs to distinguish a builder cancellation
        // from a supplier decline — no extra field/query required.
        tracking={order.tracking.map((step) => ({ status: step.status, note: step.label }))}
      />
    </div>
  );
}