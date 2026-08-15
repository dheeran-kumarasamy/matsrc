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

// Monochrome status treatment: the terminal state (FULFILLED) is the only
// one rendered as solid black, so hierarchy is carried by weight/contrast
// rather than colour (site-wide black & white palette).
const STATUS_STYLES: Record<string, string> = {
  DRAFT: "posh-status opacity-60",
  ISSUED: "posh-status",
  ACKNOWLEDGED: "posh-status",
  FULFILLED: "posh-status-strong",
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
    <div className="posh-body space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="posh-eyebrow">Procurement desk</p>
          <h1 className="posh-page-title mt-2">Purchase Orders</h1>
          <p className="posh-subtitle mt-2 max-w-2xl">
            Generate, review and digitally approve POs from accepted enquiries — entirely in-app, no printing or
            manual signature required.
          </p>
        </div>
        <span className="posh-eyebrow hidden md:inline">
          {purchaseOrders.length} {purchaseOrders.length === 1 ? "record" : "records"}
        </span>
      </header>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={s === "All" ? "/purchase-orders" : `/purchase-orders?status=${s}`}
            className={activeFilter === s ? "posh-chip-active" : "posh-chip"}
          >
            {FILTER_LABELS[s]}
          </Link>
        ))}
      </div>

      {apiError ? (
        <div className="posh-card p-10 text-center">
          <p className="text-sm font-bold text-black">Could not load purchase orders right now.</p>
          <p className="posh-muted mt-1 text-xs">Please refresh and try again.</p>
        </div>
      ) : purchaseOrders.length === 0 ? (
        <div className="posh-card p-10 text-center">
          <p className="posh-card-title">No purchase orders yet</p>
          <p className="posh-muted mt-2 text-xs">
            Once a supplier confirms a quote on an enquiry, open that order to generate its PO.
          </p>
          <Link href="/orders" className="posh-link mt-4 inline-block">
            Go to My Orders →
          </Link>
        </div>
      ) : (
        <div className="posh-card divide-y divide-black/10">
          {purchaseOrders.map((po) => (
            <div key={po.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="text-base font-bold tracking-tight text-black">
                  {po.poNumber}
                  {po.version > 1 ? (
                    <span className="posh-label ml-2 align-middle">v{po.version}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs font-semibold text-black/60">
                  {po.supplier.companyName} · {po.lineItems.length} items · INR {po.total.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className={STATUS_STYLES[po.status] ?? "posh-status"}>{po.status}</span>
                <Link href={`/purchase-orders/${po.id}`} className="posh-link">
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
