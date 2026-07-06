import Link from "next/link";
import { builderApiGet } from "@/lib/api";

type PurchaseOrderListItem = {
  id: string;
  poNumber: string;
  status: "DRAFT" | "ISSUED" | "ACKNOWLEDGED" | "FULFILLED";
  version: number;
  total: number;
  createdAt: string;
  approvedAt: string | null;
  orderId: string;
  supplier: { id: string; companyName: string };
  lineItems: Array<{ id: string }>;
};

const STATUS_FILTERS = ["All", "DRAFT", "ISSUED", "ACKNOWLEDGED", "FULFILLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  ISSUED: "bg-amber-50 text-amber-700 border-amber-200",
  ACKNOWLEDGED: "bg-blue-50 text-blue-700 border-blue-200",
  FULFILLED: "bg-green-50 text-green-700 border-green-200",
};

const FILTER_LABELS: Record<string, string> = {
  All: "All",
  DRAFT: "Draft",
  ISSUED: "Issued",
  ACKNOWLEDGED: "Acknowledged",
  FULFILLED: "Fulfilled",
};

// UF-04: Purchase Order history — Draft → Approved → Issued → Acknowledged by Supplier → Fulfilled.
// This is an additive layer on top of existing enquiry/order tracking, not a replacement.
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string | string[] };
}) {
  const rawStatus = Array.isArray(searchParams.status) ? searchParams.status[0] : searchParams.status;
  const normalized = rawStatus?.toUpperCase() ?? "All";
  const activeFilter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(normalized)
    ? (normalized as StatusFilter)
    : "All";

  let purchaseOrders: PurchaseOrderListItem[] = [];
  let apiError = false;

  try {
    const query = activeFilter === "All" ? "" : `?status=${activeFilter}`;
    purchaseOrders = await builderApiGet<PurchaseOrderListItem[]>(`/purchase-orders${query}`);
  } catch {
    purchaseOrders = [];
    apiError = true;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Purchase Orders</h1>
        <p className="mt-1 text-sm text-slate-500">
          Generate, review and digitally approve POs from accepted enquiries — entirely in-app, no printing or
          manual signature required.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={s === "All" ? "/purchase-orders" : `/purchase-orders?status=${s}`}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              activeFilter === s ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            {FILTER_LABELS[s]}
          </Link>
        ))}
      </div>

      {apiError ? (
        <div className="panel p-10 text-center">
          <p className="text-sm text-red-500">Could not load purchase orders right now.</p>
          <p className="mt-1 text-xs text-slate-400">Please refresh and try again.</p>
        </div>
      ) : purchaseOrders.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-sm text-slate-400">No purchase orders yet.</p>
          <p className="mt-1 text-xs text-slate-400">
            Once a supplier confirms a quote on an enquiry, open that order to generate its PO.
          </p>
          <Link href="/orders" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Go to My Orders →
          </Link>
        </div>
      ) : (
        <div className="panel divide-y divide-slate-100">
          {purchaseOrders.map((po) => (
            <div key={po.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {po.poNumber}
                  {po.version > 1 ? <span className="ml-1 text-xs text-slate-400">v{po.version}</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {po.supplier.companyName} · {po.lineItems.length} items · INR {po.total.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[po.status] ?? ""}`}
                >
                  {po.status}
                </span>
                <Link href={`/purchase-orders/${po.id}`} className="text-xs text-blue-700 hover:underline">
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
