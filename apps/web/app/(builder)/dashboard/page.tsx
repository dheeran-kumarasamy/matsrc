"use client";

import { useState } from "react";

// ── Static data (mirrors posh-web-flair/dashboard.tsx exactly) ───────────────

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
  ["OPC Cement 53G",   "₹380 / bag",    "-0.5%", "Below your target of ₹390"],
  ["TMT Bar Fe-500D",  "₹62,400 / T",   "+1.2%", "3 suppliers quoting"],
  ["River Sand",       "₹1,800 / cum",  "+0.8%", "Monsoon premium easing"],
  ["Structural Steel", "₹58,000 / T",   "-0.3%", "Stable for 9 days"],
];

const reports = [
  ["Spend this month",   "₹48.6 L", "-6% vs July"],
  ["On-time delivery",   "94%",     "+3 pts"],
  ["Avg. lead time",     "41 hrs",  "-7 hrs"],
  ["Savings captured",   "₹3.2 L",  "vs quoted rate"],
];

const browse = [
  ["Cement",         "18 grades"],
  ["Steel & TMT",    "42 SKUs"],
  ["Aggregates",     "11 grades"],
  ["Blocks & Bricks","26 SKUs"],
  ["Formwork",       "14 SKUs"],
  ["Finishes",       "60+ SKUs"],
];

// ── Dashboard — exact port of posh-web-flair/src/routes/dashboard.tsx ─────────
export default function DashboardPage() {
  const [view, setView] = useState<View>("Outstanding");

  return (
    <main className="relative min-h-[calc(100vh-6rem)] overflow-hidden rounded-2xl" style={{ background: "var(--posh-bg)" }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--posh-gradient-warm)" }} />
      <div className="relative flex min-h-[calc(100vh-6rem)] flex-col px-6 py-6 md:px-10 md:py-8">

        {/* ── Page header ── */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="posh-heading text-2xl tracking-tight" style={{ color: "var(--posh-fg)" }}>Buildohub</span>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.3em] sm:block" style={{ color: "var(--posh-fg-muted)" }}>
              Procurement Desk
            </span>
          </div>
          <nav className="flex items-center gap-1">
            {[
              { href: "/dashboard", label: "Dashboard" },
              { href: "/orders",    label: "Orders" },
              { href: "/watchlist", label: "Watchlist" },
              { href: "/sourcing",  label: "AI Sourcing" },
              { href: "/products",  label: "Browse" },
            ].map(({ href, label }) => (
              <a key={href} href={href} className="rounded-full px-4 py-1.5 text-sm transition-colors hover:bg-white/10"
                style={{ color: "var(--posh-fg-muted)" }}>{label}</a>
            ))}
          </nav>
        </header>

        {/* ── Two-column body ── */}
        <div className="flex flex-1 flex-col gap-6 lg:flex-row">

          {/* ── LEFT: AI Suggestions only ── */}
          <aside className="w-full lg:w-[340px] lg:shrink-0">
            <div className="rounded-3xl border p-7 backdrop-blur-xl"
              style={{ background: "rgba(36,31,22,0.40)", borderColor: "var(--posh-border)" }}>
              <div className="mb-6 flex items-center gap-2">
                <span className="size-2 animate-pulse rounded-full" style={{ background: "var(--posh-primary)" }} />
                <p className="text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: "var(--posh-fg-muted)" }}>
                  AI Suggestions
                </p>
              </div>
              <div className="space-y-5">
                {suggestions.map((s) => (
                  <div key={s.item} className="flex items-start justify-between gap-4 border-b pb-5"
                    style={{ borderColor: "var(--posh-border)" }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--posh-fg)" }}>{s.item}</p>
                      <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--posh-fg-muted)" }}>{s.why}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="posh-heading text-lg" style={{ color: "var(--posh-primary)" }}>{s.move}</p>
                      <p className="mt-0.5 font-mono text-[10px] font-semibold"
                        style={{ color: s.delta.startsWith("-") ? "#4ade80" : "#fbbf24" }}>{s.delta}</p>
                    </div>
                  </div>
                ))}
              </div>
              <a href="/sourcing" className="mt-6 inline-block text-sm transition-opacity hover:opacity-70"
                style={{ color: "var(--posh-primary)" }}>Open AI Sourcing →</a>
            </div>
          </aside>

          {/* RIGHT panel placeholder — filled below */}
          <section className="flex flex-1 flex-col overflow-hidden rounded-3xl border p-7 backdrop-blur-xl md:p-10"
            style={{ background: "rgba(36,31,22,0.40)", borderColor: "var(--posh-border)" }}>
            <nav className="flex flex-wrap gap-2">
              {views.map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className="rounded-full border px-5 py-2 text-sm transition-colors duration-300"
                  style={view === v
                    ? { borderColor: "var(--posh-primary)", background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }
                    : { borderColor: "var(--posh-border)", color: "var(--posh-fg-muted)" }}>
                  {v}
                </button>
              ))}
            </nav>
            <div key={view} className="animate-rise mt-8 flex-1">
              <RightPanelContent view={view} />

            </div>
          </section>

        </div>
      </div>
    </main>
  );
}

// ── Right panel tab content ───────────────────────────────────────────────────
function RightPanelContent({ view }: { view: View }) {
  if (view === "Outstanding") return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--posh-fg-muted)" }}>
          <tr>
            {["Order", "Material", "Supplier", "ETA", "Value", "Status"].map((h) => (
              <th key={h} className="border-b pb-3 pr-6 font-normal" style={{ borderColor: "var(--posh-border)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outstanding.map((r) => (
            <tr key={r[0]} className="transition-colors hover:bg-white/5">
              <td className="border-b py-4 pr-6" style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg-muted)" }}>{r[0]}</td>
              <td className="border-b py-4 pr-6" style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg)" }}>{r[1]}</td>
              <td className="border-b py-4 pr-6" style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg-muted)" }}>{r[2]}</td>
              <td className="border-b py-4 pr-6" style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg)" }}>{r[3]}</td>
              <td className="posh-heading border-b py-4 pr-6 text-lg" style={{ borderColor: "var(--posh-border)", color: "var(--posh-primary)" }}>{r[4]}</td>
              <td className="border-b py-4" style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg-muted)" }}>{r[5]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (view === "Watchlist") return (
    <div className="grid gap-px overflow-hidden rounded-3xl border sm:grid-cols-2"
      style={{ borderColor: "var(--posh-border)", background: "var(--posh-border)" }}>
      {watchlist.map((w) => (
        <article key={w[0]} className="p-7 transition-colors hover:bg-white/5" style={{ background: "var(--posh-bg)" }}>
          <div className="flex items-baseline justify-between">
            <h3 className="text-xl" style={{ color: "var(--posh-fg)" }}>{w[0]}</h3>
            <span className="text-xs" style={{ color: "var(--posh-primary)" }}>{w[2]}</span>
          </div>
          <p className="posh-heading mt-3 text-3xl" style={{ color: "var(--posh-fg)" }}>{w[1]}</p>
          <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{w[3]}</p>
        </article>
      ))}
    </div>
  );

  if (view === "Reports") return (
    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
      {reports.map((r) => (
        <div key={r[0]} className="rounded-3xl border p-7"
          style={{ borderColor: "var(--posh-border)", background: "rgba(36,31,22,0.60)" }}>
          <p className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--posh-fg-muted)" }}>{r[0]}</p>
          <p className="posh-heading mt-5 text-4xl" style={{ color: "var(--posh-primary)" }}>{r[1]}</p>
          <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{r[2]}</p>
        </div>
      ))}
    </div>
  );

  if (view === "Browse") return (
    <div className="grid gap-px overflow-hidden rounded-3xl border sm:grid-cols-2 xl:grid-cols-3"
      style={{ borderColor: "var(--posh-border)", background: "var(--posh-border)" }}>
      {browse.map((b) => (
        <a key={b[0]} href="/products" className="group block p-8 text-left transition-colors hover:bg-white/5"
          style={{ background: "var(--posh-bg)" }}>
          <h3 className="text-2xl" style={{ color: "var(--posh-fg)" }}>{b[0]}</h3>
          <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{b[1]}</p>
          <span className="mt-6 inline-block text-sm transition-transform duration-500 group-hover:translate-x-1"
            style={{ color: "var(--posh-primary)" }}>Browse →</span>
        </a>
      ))}
    </div>
  );

  return null;
}
