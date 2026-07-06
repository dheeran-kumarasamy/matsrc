export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSupplierPurchaseOrders } from "@/lib/purchase-order-data";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  ISSUED: "bg-amber-50 text-amber-700 border-amber-200",
  ACKNOWLEDGED: "bg-blue-50 text-blue-700 border-blue-200",
  FULFILLED: "bg-green-50 text-green-700 border-green-200",
};

// Supplier-side PO list — UF-04 visibility. Suppliers see POs the moment they're
// issued (Draft → Approved → Issued handled by builder), and can acknowledge here.
export default async function SupplierPurchaseOrdersPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const purchaseOrders = await getSupplierPurchaseOrders(session.user.email);

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-xl font-extrabold text-slate-900">Purchase Orders</h3>
        <p className="text-sm text-slate-600">
          Digitally issued POs from builders. Acknowledge receipt entirely in-app — no signature or upload needed.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">PO Number</th>
              <th className="px-4 py-3 font-semibold">Buyer</th>
              <th className="px-4 py-3 font-semibold">Items</th>
              <th className="px-4 py-3 font-semibold">Total</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">
                  {po.poNumber}
                  {po.version > 1 ? <span className="ml-1 text-xs text-slate-400">v{po.version}</span> : null}
                </td>
                <td className="px-4 py-3 text-slate-700">{po.buyerName}</td>
                <td className="px-4 py-3 text-slate-700">{po.itemCount}</td>
                <td className="px-4 py-3 text-slate-700">INR {po.total.toLocaleString("en-IN")}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[po.status] ?? ""}`}>
                    {po.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/purchase-orders/${po.id}`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {purchaseOrders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No purchase orders issued yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
