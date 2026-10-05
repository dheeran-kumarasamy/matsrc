export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OrderStatusActions } from "@/components/supplier/OrderStatusActions";
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
        <h3 className="text-xl font-extrabold text-slate-900">Order #{order.id}</h3>
        <p className="mt-1 text-sm text-slate-600">
          Buyer: {order.buyer} | Material: {order.brand ? `${order.brand} ` : ""}
          {order.material} | Delivery: {order.deliveryDate}
        </p>
        <p className="mt-1 text-sm text-slate-600">Site: {order.siteName ?? "Unassigned"}</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">Ask Price: {order.askPrice}</p>


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