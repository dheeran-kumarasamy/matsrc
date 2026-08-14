"use client";
/**
 * RotatingRail — left-column panel on the builder dashboard.
 * Panel 0 (7 s) → Recent Orders table (live data via props)
 * Panel 1 (7 s) → AI Suggestions (smart buying signals)
 * Cross-fade: 420 ms. Progress pills let users jump manually.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";

type Order = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  totalLabel: string;
  total: number;
  items: Array<{ name: string }>;
};

const SUGGESTIONS = [
  { item: "Binding Wire 18G",    why: "Reordered every 3 weeks · due now",  move: "₹72,000/T",  delta: "+2.1%" },
  { item: "Shuttering Ply 18mm", why: "Pairs with your slab schedule",       move: "₹92/sqft",   delta: "+1.3%" },
  { item: "Fly Ash Bricks",      why: "12% under your last landed rate",     move: "₹6.4/nos",   delta: "-1.8%" },
  { item: "TMT Fe-550D · 16mm",  why: "Grade upgrade, same lead time",       move: "₹64,100/T",  delta: "+0.6%" },
  { item: "Curing Compound",     why: "Watchlist supplier cut price",         move: "₹210/L",     delta: "-3.4%" },
];

const INTERVAL = 7000;
const FADE     = 420;

type Tokens = { B: string; FG: string; FM: string; P: string };

function OrdersPanel({ orders, B, FG, FM, P }: { orders: Order[] } & Tokens) {
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr>
          {["Order", "Material", "Total", "Status"].map((h) => (
            <th key={h}
              className="border-b px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: FM, borderColor: B }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {orders.length === 0 ? (
          <tr>
            <td colSpan={4} className="px-6 py-12 text-center text-sm" style={{ color: FM }}>
              No orders yet.{" "}
              <Link href="/products" className="underline underline-offset-2 transition-opacity hover:opacity-70"
                style={{ color: P }}>
                Browse materials →
              </Link>
            </td>
          </tr>
        ) : (
          orders.map((order) => (
            <tr key={order.id} className="border-b transition-colors hover:bg-white/5" style={{ borderColor: B }}>
              <td className="px-6 py-4">
                <Link href={`/orders/${order.id}`}
                  className="font-mono text-xs transition-opacity hover:opacity-70" style={{ color: P }}>
                  #{order.id.slice(0, 8)}
                </Link>
              </td>
              <td className="px-6 py-4" style={{ color: FG }}>
                {order.items?.[0]?.name ?? "—"}
                {(order.items?.length ?? 0) > 1 ? ` +${order.items.length - 1}` : ""}
              </td>
              <td className="px-6 py-4 font-medium" style={{ color: FG }}>
                {order.totalLabel ?? `₹${order.total?.toLocaleString("en-IN")}`}
              </td>
              <td className="px-6 py-4"><OrderStatusBadge status={order.status} /></td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function AiPanel({ B, FG, FM, P }: Tokens) {
  return (
    <div>
      {SUGGESTIONS.map((s) => (
        <div key={s.item}
          className="flex items-start justify-between gap-4 border-b px-6 py-4 transition-colors hover:bg-white/5"
          style={{ borderColor: B }}>
          <div className="min-w-0">
            <p className="text-sm font-medium" style={{ color: FG }}>{s.item}</p>
            <p className="mt-1 text-xs" style={{ color: FM }}>{s.why}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="posh-heading text-lg" style={{ color: P }}>{s.move}</p>
            <p className="mt-0.5 font-mono text-[10px] font-semibold"
              style={{ color: s.delta.startsWith("-") ? "#4ade80" : "#fbbf24" }}>
              {s.delta}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RotatingRail({ orders }: { orders: Order[] }) {
  const [panel, setPanel] = useState(0);
  const [fade,  setFade]  = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setPanel((p) => (p === 0 ? 1 : 0)); setFade(true); }, FADE);
    }, INTERVAL);
    return () => clearInterval(t);
  }, []);

  function jumpTo(i: number) {
    if (i === panel) return;
    setFade(false);
    setTimeout(() => { setPanel(i); setFade(true); }, FADE);
  }

  const isOrders = panel === 0;
  const B = "var(--posh-border)";
  const FG = "var(--posh-fg)";
  const FM = "var(--posh-fg-muted)";
  const P  = "var(--posh-primary)";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border"
      style={{ background: "var(--posh-bg-card)", borderColor: B }}>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-4" style={{ borderColor: B }}>
        <div className="flex items-center gap-3">
          <span className={`size-2 rounded-full ${!isOrders ? "animate-pulse" : ""}`} style={{ background: P }} />
          <h2 className="posh-heading text-xl" style={{ color: FG }}>
            {isOrders ? "Recent Orders" : "AI Suggestions"}
          </h2>
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.2em] sm:block" style={{ color: FM }}>
            {isOrders ? "Active procurement" : "Smart buying signals"}
          </span>
        </div>
        {isOrders
          ? <Link href="/orders" className="text-xs font-medium transition-opacity hover:opacity-70" style={{ color: P }}>View all →</Link>
          : <Link href="/sourcing" className="text-xs font-medium transition-opacity hover:opacity-70" style={{ color: P }}>Open AI Sourcing →</Link>
        }
      </div>

      {/* Content — cross-fades */}
      <div className="flex-1 overflow-x-auto" style={{ opacity: fade ? 1 : 0, transition: `opacity ${FADE}ms ease` }}>
        {isOrders ? <OrdersPanel orders={orders} B={B} FG={FG} FM={FM} P={P} /> : <AiPanel B={B} FG={FG} FM={FM} P={P} />}
      </div>

      {/* Progress pills */}
      <div className="flex shrink-0 items-center gap-1.5 border-t px-6 py-3" style={{ borderColor: B }}>
        {[0, 1].map((i) => (
          <button key={i} type="button" onClick={() => jumpTo(i)}
            className="h-1 rounded-full transition-all duration-300"
            style={{ width: i === panel ? "1.5rem" : "0.375rem", background: i === panel ? P : B }}
            aria-label={i === 0 ? "Show recent orders" : "Show AI suggestions"} />
        ))}
        <span className="ml-2 text-[10px] uppercase tracking-[0.2em]" style={{ color: FM }}>
          {isOrders ? "1 / 2 — Orders" : "2 / 2 — AI Picks"}
        </span>
      </div>
    </div>
  );
}
