"use client";

import axios from "axios";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KpiCard } from "@/components/supplier/KpiCard";
import { OrderQueueTable } from "@/components/supplier/OrderQueueTable";
import { ListingDetailButton } from "@/components/supplier/ListingDetailButton";
import { OrderDetailButton } from "@/components/supplier/OrderDetailButton";
import type { SupplierListingRow } from "@/lib/supplier-data";


type DashboardKpi = {
  label: string;
  value: string;
  hint: string;
};

type DashboardOrder = {
  id: string;
  material: string;
  quantity: string;
  eta: string;
  status: "NEW" | "PACKING" | "IN_TRANSIT";
};

type QueueKey = "listings" | "orders" | "rfqs";

type PendingEnquiry = {
  id: string;
  material: string;
  quantity: string;
  eta: string;
};

const cardQueueMap: Record<string, QueueKey> = {
  "Active Listings": "listings",
  "Incoming Orders": "orders",
  "Pending Enquiries": "rfqs",
};

function ListingQueueTable({ listings }: { listings: SupplierListingRow[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-7 py-5">
        <h3 className="text-4xl font-extrabold text-slate-900">Active Listings Queue</h3>
      </div>
      {listings.length === 0 ? (
        <p className="px-7 py-10 text-xl text-slate-500">No active listings available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xl">
            <thead className="bg-slate-100 text-left text-slate-700">
              <tr>
                <th className="px-7 py-4 font-bold">Product</th>
                <th className="px-7 py-4 font-bold">Category</th>
                <th className="px-7 py-4 font-bold">Price</th>
                <th className="px-7 py-4 font-bold">Stock</th>
                <th className="px-7 py-4 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-7 py-5 text-slate-800">
                    <ListingDetailButton
                      listingId={item.id}
                      label={item.name}
                      className="font-semibold text-blue-700 underline decoration-dotted hover:text-blue-900"
                    />
                  </td>
                  <td className="px-7 py-5 text-slate-800">{item.category}</td>
                  <td className="px-7 py-5 text-slate-800">{item.price}</td>
                  <td className="px-7 py-5 text-slate-800">{item.stock}</td>
                  <td className="px-7 py-5">
                    <span className={`rounded-full px-4 py-1 text-base font-semibold ${item.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                      {item.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PendingEnquiryQueueTable({ enquiries }: { enquiries: PendingEnquiry[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function updateEnquiry(orderId: string, status: "PROCESSING" | "CANCELLED") {
    setPendingId(`${orderId}:${status}`);
    try {
      await axios.patch(`/api/supplier/orders/${orderId}`, { status });
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-7 py-5">
        <h3 className="text-4xl font-extrabold text-slate-900">Pending Enquiries Queue</h3>
      </div>
      {enquiries.length === 0 ? (
        <p className="px-7 py-10 text-xl text-slate-500">No pending enquiries right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xl">
            <thead className="bg-slate-100 text-left text-slate-700">
              <tr>
                <th className="px-7 py-4 font-bold">Enquiry</th>
                <th className="px-7 py-4 font-bold">Material</th>
                <th className="px-7 py-4 font-bold">Quantity</th>
                <th className="px-7 py-4 font-bold">Required By</th>
                <th className="px-7 py-4 font-bold">Decision</th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map((enquiry) => (
                <tr key={enquiry.id} className="border-t border-slate-100">
                  <td className="px-7 py-5 text-slate-800">
                    <OrderDetailButton
                      orderId={enquiry.id}
                      label={`ENQ-${enquiry.id.slice(-5).toUpperCase()}`}
                      className="font-semibold text-blue-700 underline decoration-dotted hover:text-blue-900"
                    />
                  </td>
                  <td className="px-7 py-5 text-slate-800">{enquiry.material}</td>
                  <td className="px-7 py-5 text-slate-800">{enquiry.quantity}</td>
                  <td className="px-7 py-5 text-slate-800">{enquiry.eta}</td>
                  <td className="px-7 py-5">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingId !== null}
                        onClick={() => updateEnquiry(enquiry.id, "PROCESSING")}
                        className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                      >
                        {pendingId === `${enquiry.id}:PROCESSING` ? "Updating..." : "Accept"}
                      </button>
                      <button
                        type="button"
                        disabled={pendingId !== null}
                        onClick={() => updateEnquiry(enquiry.id, "CANCELLED")}
                        className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      >
                        {pendingId === `${enquiry.id}:CANCELLED` ? "Updating..." : "Reject"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DashboardQueueSwitcher({
  kpis,
  orders,
  listings,
  pendingEnquiries,
}: {
  kpis: DashboardKpi[];
  orders: DashboardOrder[];
  listings: SupplierListingRow[];
  pendingEnquiries: PendingEnquiry[];
}) {
  const [activeQueue, setActiveQueue] = useState<QueueKey>("orders");

  const queueContent = useMemo(() => {
    if (activeQueue === "listings") return <ListingQueueTable listings={listings} />;
    if (activeQueue === "rfqs") return <PendingEnquiryQueueTable enquiries={pendingEnquiries} />;
    return <OrderQueueTable orders={orders} />;
  }, [activeQueue, listings, orders, pendingEnquiries]);

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const mappedQueue = cardQueueMap[kpi.label];
          const clickable = Boolean(mappedQueue);
          const active = clickable && activeQueue === mappedQueue;

          if (!clickable) {
            return <KpiCard key={kpi.label} {...kpi} />;
          }

          return (
            <button
              type="button"
              key={kpi.label}
              onClick={() => setActiveQueue(mappedQueue)}
              className="text-left"
              aria-pressed={active}
              aria-label={`Show ${kpi.label.toLowerCase()} queue`}
            >
              <KpiCard
                {...kpi}
                className={`cursor-pointer transition ${
                  active
                    ? "border-teal-400 ring-2 ring-teal-200"
                    : "hover:border-teal-300 hover:shadow-md"
                }`}
              />
            </button>
          );
        })}
      </section>

      <section>{queueContent}</section>
    </>
  );
}
