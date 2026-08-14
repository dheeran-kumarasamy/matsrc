"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ── Static data — exact copy from posh-web-flair/dashboard.tsx ───────────────
const recentOrders = [
  { id: "BH-4821", item: "TMT Fe-500D · 12mm",  qty: "18 T",      value: "₹11,23,200", state: "In transit" },
  { id: "BH-4814", item: "OPC 53G Cement",       qty: "600 bags",  value: "₹2,28,000",  state: "Delivered" },
  { id: "BH-4802", item: "M-Sand (Zone II)",     qty: "40 cum",    value: "₹72,000",    state: "At weighbridge" },
  { id: "BH-4791", item: "AAC Blocks 600×200",   qty: "1,100 nos", value: "₹3,52,000",  state: "Delivered" },
  { id: "BH-4780", item: "MS Pipe 50NB",          qty: "4.2 T",    value: "₹2,85,600",  state: "Dispatched" },
];

const suggestions = [
  { item: "Binding Wire 18G",    why: "Reordered every 3 weeks · due now",  move: "₹72,000/T",  delta: "+2.1%" },
  { item: "Shuttering Ply 18mm", why: "Pairs with your slab schedule",       move: "₹92/sqft",   delta: "+1.3%" },
  { item: "Fly Ash Bricks",      why: "12% under your last landed rate",     move: "₹6.4/nos",   delta: "-1.8%" },
  { item: "TMT Fe-550D · 16mm",  why: "Grade upgrade, same lead time",       move: "₹64,100/T",  delta: "+0.6%" },
  { item: "Curing Compound",     why: "Watchlist supplier cut price",         move: "₹210/L",     delta: "-3.4%" },
];

const views = ["Outstanding", "Watchlist", "Reports", "Browse"] as const;
type View = (typeof views)[number];

const outstanding = [
  ["BH-4821", "TMT Fe-500D · 12mm", "Shree Steels",     "14 Aug", "₹11,23,200", "In transit"],
  ["BH-4802", "M-Sand (Zone II)",   "Kaveri Aggregates", "13 Aug", "₹72,000",    "At weighbridge"],
  ["BH-4780", "MS Pipe 50NB",       "Nandi Tubes",       "16 Aug", "₹2,85,600",  "Dispatched"],
  ["BH-4776", "Formwork Ply",       "Anand Timber",      "18 Aug", "₹1,48,400",  "Confirmed"],
];

const watchlist = [
  ["OPC Cement 53G",   "₹380 / bag",   "-0.5%", "Below your target of ₹390"],
  ["TMT Bar Fe-500D",  "₹62,400 / T",  "+1.2%", "3 suppliers quoting"],
  ["River Sand",       "₹1,800 / cum", "+0.8%", "Monsoon premium easing"],
  ["Structural Steel", "₹58,000 / T",  "-0.3%", "Stable for 9 days"],
];

const reports = [
  ["Spend this month", "₹48.6 L", "-6% vs July"],
  ["On-time delivery", "94%",     "+3 pts"],
  ["Avg. lead time",   "41 hrs",  "-7 hrs"],
  ["Savings captured", "₹3.2 L",  "vs quoted rate"],
];

const browse = [
  ["Cement",          "18 grades", "cement"],
  ["Steel & TMT",     "42 SKUs",   "steel"],
  ["Aggregates",      "11 grades", "aggregates"],
  ["Blocks & Bricks", "26 SKUs",   "bricks"],
  ["Formwork",        "14 SKUs",   "formwork"],
  ["Finishes",        "60+ SKUs",  "finishes"],
];

// Header nav links — wired to real pages
const NAV_LINKS = [
  { href: "/newdashboard", label: "Dashboard" },
  { href: "/orders",       label: "Orders" },
  { href: "/watchlist",    label: "Watchlist" },
  { href: "/reports",      label: "Reports" },
  { href: "/products",     label: "Browse" },
];

// CSS token shortcuts: git CSS vars → matsrc globals.css equivalents
const BG       = "var(--posh-bg)";
const BGCARD   = "var(--posh-bg-card)";
const FG       = "var(--posh-fg)";
const FM       = "var(--posh-fg-muted)";
const P        = "var(--posh-primary)";
const PFG      = "var(--posh-primary-fg)";
const BORDER   = "var(--posh-border)";
const BSUB     = "rgba(240,232,216,0.08)";
const GRADIENT = "var(--posh-gradient-warm)";
const PANELBG  = "rgba(28,24,16,0.40)";
const CARDBG   = "rgba(36,31,22,0.60)";

// ── Full-screen standalone page — posh-web-flair dashboard.tsx faithful port ──
export default function NewDashboardPage() {
  const [panel, setPanel] = useState(0);  // 0 = recentOrders, 1 = suggestions
  const [fade,  setFade]  = useState(true);
  const [view,  setView]  = useState<View>("Outstanding");

  // Rotate left panel every 7 s with 420 ms crossfade — mirrors git exactly
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setPanel((p) => (p === 0 ? 1 : 0)); setFade(true); }, 420);
    }, 7000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden" style={{ background: BG }}>
      {/* Warm radial gradient overlay */}
      <div className="pointer-events-none absolute inset-0" style={{ background: GRADIENT }} />

      <div className="relative mx-auto flex min-h-screen max-w-[110rem] flex-col px-6 py-6 md:px-10 md:py-8">

        {/* ── Header: brand + real nav links ── */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="posh-heading text-2xl tracking-tight" style={{ color: FG }}>
              Buildohub
            </Link>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.3em] sm:block" style={{ color: FM }}>
              Procurement Desk
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link key={href} href={href}
                className="rounded-full px-4 py-1.5 text-sm transition-colors hover:bg-white/10"
                style={{ color: FM }}>
                {label}
              </Link>
            ))}
          </nav>
        </header>

        {/* ── Two-column body ── */}
        <div className="mt-8 flex flex-1 flex-col gap-6 lg:flex-row">

          {/* LEFT PANEL — rotating recentOrders (7 s) ↔ suggestions (7 s) */}
          <aside className="flex w-full flex-col rounded-[2rem] border p-7 lg:w-[340px] lg:shrink-0"
            style={{ background: PANELBG, borderColor: BORDER }}>

            {/* Panel header: label + contextual link */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full transition-all ${panel === 1 ? "animate-pulse" : ""}`}
                  style={{ background: P }} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em]" style={{ color: FM }}>
                  {panel === 0 ? "Recent Orders" : "AI Suggestions"}
                </p>
              </div>
              {panel === 0
                ? <Link href="/orders" className="text-xs transition-opacity hover:opacity-70" style={{ color: P }}>View all →</Link>
                : <Link href="/sourcing" className="text-xs transition-opacity hover:opacity-70" style={{ color: P }}>Open AI sourcing →</Link>
              }
            </div>

            {/* Crossfading content area */}
            <div className="flex-1" style={{ opacity: fade ? 1 : 0, transition: "opacity 420ms ease" }}>
              {panel === 0 ? (
                /* Panel 0: recent orders cards → /orders */
                <div className="space-y-4">
                  {recentOrders.map((o) => (
                    <Link key={o.id} href="/orders"
                      className="block rounded-2xl border p-4 transition-colors hover:bg-white/5"
                      style={{ borderColor: BSUB }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: FG }}>{o.item}</p>
                          <p className="mt-0.5 text-xs" style={{ color: FM }}>{o.qty} · {o.id}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="posh-heading text-base" style={{ color: P }}>{o.value}</p>
                          <p className="mt-0.5 text-[10px]" style={{ color: FM }}>{o.state}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                /* Panel 1: AI suggestions → /sourcing */
                <div className="space-y-5">
                  {suggestions.map((s) => (
                    <div key={s.item} className="flex items-start justify-between gap-3 border-b pb-5"
                      style={{ borderColor: BSUB }}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: FG }}>{s.item}</p>
                        <p className="mt-1 text-xs leading-relaxed" style={{ color: FM }}>{s.why}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="posh-heading text-base" style={{ color: P }}>{s.move}</p>
                        <p className="mt-0.5 font-mono text-[10px] font-semibold"
                          style={{ color: s.delta.startsWith("-") ? "#4ade80" : "#fbbf24" }}>
                          {s.delta}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT PANEL — 4 tabs: Outstanding · Watchlist · Reports · Browse */}
          <section className="flex flex-1 flex-col overflow-hidden rounded-[2rem] border p-7 md:p-10"
            style={{ background: PANELBG, borderColor: BORDER }}>

            {/* Tab nav */}
            <nav className="flex flex-wrap gap-2">
              {views.map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className="rounded-full border px-5 py-2 text-sm transition-colors duration-300"
                  style={view === v
                    ? { borderColor: P, background: P, color: PFG }
                    : { borderColor: BORDER, color: FM }}>
                  {v}
                </button>
              ))}
            </nav>

            {/* Tab content — animate-rise re-runs on every key change */}
            <div key={view} className="animate-rise mt-8 flex-1">

              {/* Outstanding — static table, IDs link to /orders */}
              {view === "Outstanding" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-[0.2em]" style={{ color: FM }}>
                      <tr>
                        {["Order", "Material", "Supplier", "ETA", "Value", "Status"].map((h) => (
                          <th key={h} className="border-b pb-3 pr-6 font-normal" style={{ borderColor: BSUB }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {outstanding.map((r) => (
                        <tr key={r[0]} className="transition-colors hover:bg-white/5">
                          <td className="border-b py-4 pr-6" style={{ borderColor: BSUB, color: FM }}>
                            <Link href="/orders" className="hover:underline" style={{ color: P }}>{r[0]}</Link>
                          </td>
                          <td className="border-b py-4 pr-6" style={{ borderColor: BSUB, color: FG }}>{r[1]}</td>
                          <td className="border-b py-4 pr-6" style={{ borderColor: BSUB, color: FM }}>{r[2]}</td>
                          <td className="border-b py-4 pr-6" style={{ borderColor: BSUB, color: FG }}>{r[3]}</td>
                          <td className="posh-heading border-b py-4 pr-6 text-lg" style={{ borderColor: BSUB, color: P }}>{r[4]}</td>
                          <td className="border-b py-4" style={{ borderColor: BSUB, color: FM }}>{r[5]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Watchlist — cards → /watchlist */}
              {view === "Watchlist" && (
                <div className="grid gap-px overflow-hidden rounded-3xl border sm:grid-cols-2"
                  style={{ borderColor: BORDER, background: BORDER }}>
                  {watchlist.map((w) => (
                    <Link key={w[0]} href="/watchlist"
                      className="block p-7 transition-colors hover:bg-white/5"
                      style={{ background: BG }}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-xl" style={{ color: FG }}>{w[0]}</h3>
                        <span className="text-xs" style={{ color: P }}>{w[2]}</span>
                      </div>
                      <p className="posh-heading mt-3 text-3xl" style={{ color: FG }}>{w[1]}</p>
                      <p className="mt-2 text-sm" style={{ color: FM }}>{w[3]}</p>
                    </Link>
                  ))}
                </div>
              )}

              {/* Reports — KPI cards → /reports */}
              {view === "Reports" && (
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
                  {reports.map((r) => (
                    <Link key={r[0]} href="/reports"
                      className="block rounded-3xl border p-7 transition-colors hover:bg-white/5"
                      style={{ borderColor: BORDER, background: CARDBG }}>
                      <p className="text-xs uppercase tracking-[0.25em]" style={{ color: FM }}>{r[0]}</p>
                      <p className="posh-heading mt-5 text-4xl" style={{ color: P }}>{r[1]}</p>
                      <p className="mt-2 text-sm" style={{ color: FM }}>{r[2]}</p>
                    </Link>
                  ))}
                </div>
              )}

              {/* Browse — category grid → /products?category= */}
              {view === "Browse" && (
                <div className="grid gap-px overflow-hidden rounded-3xl border sm:grid-cols-2 xl:grid-cols-3"
                  style={{ borderColor: BORDER, background: BORDER }}>
                  {browse.map((b) => (
                    <Link key={b[0]} href={`/products?category=${b[2]}`}
                      className="group block p-8 text-left transition-colors hover:bg-white/5"
                      style={{ background: BG }}>
                      <h3 className="text-2xl" style={{ color: FG }}>{b[0]}</h3>
                      <p className="mt-2 text-sm" style={{ color: FM }}>{b[1]}</p>
                      <span className="mt-6 inline-block text-sm transition-transform duration-500 group-hover:translate-x-1"
                        style={{ color: P }}>Browse →</span>
                    </Link>
                  ))}
                </div>
              )}

            </div>
          </section>

        </div>
      </div>
    </main>
  );
}
