export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OrderStatusActions } from "@/components/supplier/OrderStatusActions";
import { RfqQuotationForm } from "@/components/supplier/RfqQuotationForm";
import { SupplierInvoiceUpload } from "@/components/supplier/SupplierInvoiceUpload";
import { getSupplierOrderDetail } from "@/lib/supplier-data";
import { AutoRefresh } from "@/components/supplier/AutoRefresh";

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
      <AutoRefresh intervalMs={5000} />
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xl font-extrabold text-slate-900">Order {order.displayOrderNumber}</h3>
          {order.itemsCount > 1 ? (
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
              {order.itemsCount} Materials
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Buyer: {order.buyer} | Delivery: {order.deliveryDate}
        </p>
        {order.isReadyForDispatch ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Site: {order.siteName ?? "Unassigned"}
              {order.sitePincode ? ` (Pincode: ${order.sitePincode})` : ""}
            </p>
            {order.deliveryAddress ? (
              <p className="mt-1 text-sm text-slate-600">Address: {order.deliveryAddress}</p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">Site Pincode: {order.sitePincode ?? "Not specified"}</p>
        )}

        {/* Order Materials Table */}
        <div className="mt-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Order Materials</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Material</th>
                  <th className="px-4 py-2.5">Quantity</th>
                  <th className="px-4 py-2.5">Ask Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {order.items && order.items.length > 0 ? (
                  order.items.map((item, idx) => (
                    <tr key={item.id ?? idx}>
                      <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        {item.brand ? (
                          <span className="block text-xs font-semibold text-slate-400">{item.brand}</span>
                        ) : null}
                        <span className="font-semibold text-slate-800">{item.material}</span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-700">{item.quantity}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{item.askPrice}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">1</td>
                    <td className="px-4 py-2.5">
                      {order.brand ? <span className="block text-xs font-semibold text-slate-400">{order.brand}</span> : null}
                      <span className="font-semibold text-slate-800">{order.material}</span>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{order.quantity}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{order.askPrice}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {order.isClosedToSupplier ? (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <div className="flex items-center gap-2 font-bold text-amber-950">
              <svg className="h-5 w-5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Enquiry No Longer Active For Fulfilment</span>
            </div>
            <p className="mt-1 text-sm text-amber-800">
              {order.closureReason || "This enquiry/order is no longer required for fulfilment. Possible reasons include: requirement fulfilled by another option, project schedule revision, specification adjustment, or quotation window closed."}
            </p>
          </div>
        ) : null}

        {!order.isClosedToSupplier ? (
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
        ) : null}

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
        {!order.isClosedToSupplier && order.status === "PLACED" && order.requiresQuotation ? (
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
        {!order.isClosedToSupplier && order.status !== "PLACED" ? <SupplierInvoiceUpload orderId={order.id} /> : null}
      </section>

      {order.isClosedToSupplier ? (
        <aside className="panel p-5">
          <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Order Status</h4>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
            <span className="inline-block rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-700">
              Closed
            </span>
            <p className="mt-2 text-xs text-slate-600">
              This enquiry is no longer required for fulfilment. No further action is needed.
            </p>
          </div>
        </aside>
      ) : (
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
      )}
    </div>
  );
}