export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSupplierPurchaseOrderDetail } from "@/lib/purchase-order-data";
import { PurchaseOrderAcknowledgeButton } from "@/components/supplier/PurchaseOrderAcknowledgeButton";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  ISSUED: "bg-amber-50 text-amber-700 border-amber-200",
  ACKNOWLEDGED: "bg-blue-50 text-blue-700 border-blue-200",
  FULFILLED: "bg-green-50 text-green-700 border-green-200",
};

export default async function SupplierPurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const po = await getSupplierPurchaseOrderDetail(params.id, session.user.email);
  if (!po) notFound();

  return (
    <section className="space-y-4">
      <div className="panel flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <h3 className="text-xl font-extrabold text-slate-900">
            {po.poNumber}
            {po.version > 1 ? <span className="ml-2 text-sm text-slate-400">v{po.version}</span> : null}
          </h3>
          <p className="text-sm text-slate-600">Buyer: {po.buyerName}</p>
          <p className="text-xs text-slate-400">Linked order: {po.orderId}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[po.status] ?? ""}`}>
          {po.status}
        </span>
      </div>

      {po.status === "ISSUED" && po.approvedAt ? (
        <div className="panel border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Digitally approved by {po.approvedBy ?? "builder"} on {new Date(po.approvedAt).toLocaleString()}. This
          e-signature equivalent replaces the need for a physical signature or stamp.
        </div>
      ) : null}

      <div className="panel overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h4 className="font-semibold text-slate-800">Line Items</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Product</th>
                <th className="px-4 py-2 font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Unit Price</th>
                <th className="px-4 py-2 font-semibold">Tax</th>
                <th className="px-4 py-2 font-semibold">Delivery</th>
                <th className="px-4 py-2 font-semibold">Fulfilled</th>
                <th className="px-4 py-2 font-semibold">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((li) => (
                <tr key={li.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-800">{li.productName}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {li.quantity} {li.unit}
                  </td>
                  <td className="px-4 py-2 text-slate-700">INR {li.unitPrice.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2 text-slate-700">INR {li.tax.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {li.deliveryDate ? new Date(li.deliveryDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-700">
                    {li.fulfilledQuantity}/{li.quantity}
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-800">
                    INR {li.lineTotal.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <span className="text-sm text-slate-500">Total</span>
          <span className="text-lg font-extrabold text-slate-900">INR {po.total.toLocaleString("en-IN")}</span>
        </div>
      </div>

      {po.notes ? (
        <div className="panel p-4">
          <h4 className="mb-1 font-semibold text-slate-800">Notes from buyer</h4>
          <p className="text-sm text-slate-600">{po.notes}</p>
        </div>
      ) : null}

      <div className="panel flex flex-wrap items-center justify-between gap-4 p-4">
        <a
          href={po.exportUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Download PO (PDF/JSON)
        </a>
        <div className="w-full max-w-xs sm:w-auto">
          <PurchaseOrderAcknowledgeButton poId={po.id} status={po.status} />
        </div>
      </div>
    </section>
  );
}
