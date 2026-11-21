import Link from "next/link";
import { adminApiGet } from "@/lib/api";
import { requireAdminAccess } from "@/lib/rbac";

export type AdminOrderListItem = {
  id: string;
  orderNumber: string | null;
  enquiryId: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  builder: { name: string | null; email: string | null; phone: string | null } | null;
  itemCount: number;
  items: Array<{ id: string; name: string; quantity: number; unit: string }>;
  totalQuotesCount: number;
  pendingReviewCount: number;
  sentToBuyerCount: number;
  isLocked: boolean;
};

export default async function AdminOrdersPage() {
  await requireAdminAccess();

  const orders = await adminApiGet<AdminOrderListItem[]>("/admin/orders").catch(() => []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-950">Orders & Enquiries (RFQs)</h1>
          <p className="text-sm text-slate-500">
            Track customer enquiries, review incoming supplier quotations, adjust markups, and release curated offers to buyers.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {orders.length} Total Enquiries / Orders
        </span>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          No orders or RFQs found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-3.5">Reference #</th>
                  <th className="px-6 py-3.5">Buyer</th>
                  <th className="px-6 py-3.5">Items</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Supplier Quotations</th>
                  <th className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-slate-900">
                      <div>
                        {order.enquiryId}
                        {order.orderNumber ? (
                          <span className="block text-xs font-normal text-slate-400">
                            Order: {order.orderNumber}
                          </span>
                        ) : null}
                        <span className="block text-[11px] font-normal text-slate-400">
                          {new Date(order.createdAt).toLocaleDateString("en-IN")}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{order.builder?.name || "Builder"}</div>
                      <div className="text-xs text-slate-500">{order.builder?.phone || order.builder?.email || "—"}</div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">{order.itemCount} item(s)</span>
                      <div className="mt-0.5 max-w-xs truncate text-[11px] text-slate-400">
                        {order.items.map((i) => `${i.name} (${i.quantity} ${i.unit})`).join(", ")}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-800">
                        {order.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {order.totalQuotesCount === 0 ? (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                          Awaiting Quotes
                        </span>
                      ) : order.pendingReviewCount > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                          {order.pendingReviewCount} Pending Review
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                          {order.sentToBuyerCount} Sent to Buyer
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/orders/${order.id}`}
                        className={`inline-flex items-center rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                          order.pendingReviewCount > 0
                            ? "bg-emerald-600 text-white shadow hover:bg-emerald-700"
                            : "bg-slate-900 text-white hover:bg-slate-800"
                        }`}
                      >
                        {order.pendingReviewCount > 0 ? "Review Quotations →" : "View Details →"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

