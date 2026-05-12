"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/supplier/KpiCard";
import { OrderQueueTable } from "@/components/supplier/OrderQueueTable";
import type { SupplierListingRow, SupplierRfqCard } from "@/lib/supplier-data";

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

const cardQueueMap: Record<string, QueueKey> = {
  "Active Listings": "listings",
  "Incoming Orders": "orders",
  "Open RFQs": "rfqs",
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
                  <td className="px-7 py-5 text-slate-800">{item.name}</td>
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

function RfqQueueTable({ rfqs }: { rfqs: SupplierRfqCard[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-7 py-5">
        <h3 className="text-4xl font-extrabold text-slate-900">Open RFQ Queue</h3>
      </div>
      {rfqs.length === 0 ? (
        <p className="px-7 py-10 text-xl text-slate-500">No RFQs available right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xl">
            <thead className="bg-slate-100 text-left text-slate-700">
              <tr>
                <th className="px-7 py-4 font-bold">RFQ</th>
                <th className="px-7 py-4 font-bold">Material</th>
                <th className="px-7 py-4 font-bold">Quantity</th>
                <th className="px-7 py-4 font-bold">Pincode</th>
                <th className="px-7 py-4 font-bold">Due By</th>
                <th className="px-7 py-4 font-bold">Your Quote</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.map((rfq) => (
                <tr key={rfq.id} className="border-t border-slate-100">
                  <td className="px-7 py-5 text-slate-800">RFQ-{rfq.id.slice(-5).toUpperCase()}</td>
                  <td className="px-7 py-5 text-slate-800">{rfq.material}</td>
                  <td className="px-7 py-5 text-slate-800">{rfq.quantity}</td>
                  <td className="px-7 py-5 text-slate-800">{rfq.pincode}</td>
                  <td className="px-7 py-5 text-slate-800">{rfq.dueBy}</td>
                  <td className="px-7 py-5 text-slate-800">{rfq.latestQuote ? `INR ${rfq.latestQuote.price}` : "Not quoted"}</td>
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
  rfqs,
}: {
  kpis: DashboardKpi[];
  orders: DashboardOrder[];
  listings: SupplierListingRow[];
  rfqs: SupplierRfqCard[];
}) {
  const [activeQueue, setActiveQueue] = useState<QueueKey>("orders");

  const queueContent = useMemo(() => {
    if (activeQueue === "listings") return <ListingQueueTable listings={listings} />;
    if (activeQueue === "rfqs") return <RfqQueueTable rfqs={rfqs} />;
    return <OrderQueueTable orders={orders} />;
  }, [activeQueue, listings, orders, rfqs]);

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
