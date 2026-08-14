"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

// ── Static data — verbatim from posh-web-flair/src/routes/dashboard.tsx ───────

const recentOrders = [
  { id: "BH-4821", item: "TMT Fe-500D · 12mm",  qty: "18 T",      value: "₹11,23,200", state: "In transit"     },
  { id: "BH-4814", item: "OPC 53G Cement",       qty: "600 bags",  value: "₹2,28,000",  state: "Delivered"      },
  { id: "BH-4802", item: "M-Sand (Zone II)",     qty: "40 cum",    value: "₹72,000",    state: "At weighbridge" },
  { id: "BH-4791", item: "AAC Blocks 600×200",   qty: "1,100 nos", value: "₹3,52,000",  state: "Delivered"      },
  { id: "BH-4780", item: "MS Pipe 50NB",         qty: "4.2 T",     value: "₹2,85,600",  state: "Dispatched"     },
];

const suggestions = [
  { item: "Binding Wire 18G",    why: "Reordered every 3 weeks · due now", move: "₹72,000/T",  delta: "+2.1%" },
  { item: "Shuttering Ply 18mm", why: "Pairs with your slab schedule",      move: "₹92/sqft",   delta: "+1.3%" },
  { item: "Fly Ash Bricks",      why: "12% under your last landed rate",    move: "₹6.4/nos",   delta: "-1.8%" },
  { item: "TMT Fe-550D · 16mm",  why: "Grade upgrade, same lead time",      move: "₹64,100/T",  delta: "+0.6%" },
  { item: "Curing Compound",     why: "Watchlist supplier cut price",        move: "₹210/L",     delta: "-3.4%" },
];

const views = ["Outstanding", "Watchlist", "Reports", "Browse"] as const;
type View = (typeof views)[number];

const outstanding = [
  ["BH-4821", "TMT Fe-500D · 12mm", "Shree Steels",     "14 Aug", "₹11,23,200", "In transit"    ],
  ["BH-4802", "M-Sand (Zone II)",   "Kaveri Aggregates", "13 Aug", "₹72,000",    "At weighbridge"],
  ["BH-4780", "MS Pipe 50NB",       "Nandi Tubes",       "16 Aug", "₹2,85,600",  "Dispatched"    ],
  ["BH-4776", "Formwork Ply",       "Anand Timber",      "18 Aug", "₹1,48,400",  "Confirmed"     ],
];

const watchlist = [
  ["OPC Cement 53G",   "₹380 / bag",   "-0.5%", "Below your target of ₹390"],
  ["TMT Bar Fe-500D",  "₹62,400 / T",  "+1.2%", "3 suppliers quoting"      ],
  ["River Sand",       "₹1,800 / cum", "+0.8%", "Monsoon premium easing"   ],
  ["Structural Steel", "₹58,000 / T",  "-0.3%", "Stable for 9 days"        ],
];

const reports = [
  ["Spend this month", "₹48.6 L", "-6% vs July"   ],
  ["On-time delivery", "94%",     "+3 pts"         ],
  ["Avg. lead time",   "41 hrs",  "-7 hrs"         ],
  ["Savings captured", "₹3.2 L",  "vs quoted rate" ],
];

const browse = [
  ["Cement",          "18 grades", "cement"    ],
  ["Steel & TMT",     "42 SKUs",   "steel"     ],
  ["Aggregates",      "11 grades", "aggregates"],
  ["Blocks & Bricks", "26 SKUs",   "bricks"    ],
  ["Formwork",        "14 SKUs",   "formwork"  ],
  ["Finishes",        "60+ SKUs",  "finishes"  ],
];

export default function NewDashboardPage() {
  const { data: session } = useSession();
  const [panel, setPanel] = useState(0);
  const [fade,  setFade]  = useState(true);
  const [view,  setView]  = useState<View>("Outstanding");

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setPanel((p) => (p === 0 ? 1 : 0)); setFade(true); }, 420);
    }, 7000);
    return () => clearInterval(t);
  }, []);

  const navLinks = [
    { href: "/newdashboard", label: "Dashboard" },
    { href: "/orders",       label: "Orders"    },
    { href: "/watchlist",    label: "Watchlist" },
    { href: "/reports",      label: "Reports"   },
    { href: "/products",     label: "Browse"    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden" style={{ background: "var(--posh-bg)" }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--posh-gradient-warm)" }} />
      <div className="relative mx-auto flex min-h-screen max-w-[110rem] flex-col px-6 py-6 md:px-10 md:py-8">

        {/* HEADER */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="posh-heading text-2xl tracking-tight" style={{ color: "var(--posh-fg)" }}>Buildohub</Link>
            <span className="hidden text-xs tracking-[0.2em] sm:block" style={{ color: "var(--posh-fg-muted)" }}>Procurement Desk</span>
          </div>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href} className="rounded-full px-4 py-1.5 transition-colors hover:bg-white/10" style={{ color: "var(--posh-fg-muted)" }}>{label}</Link>
            ))}
            <span className="mx-1 opacity-20" style={{ color: "var(--posh-fg)" }}>|</span>
            {session?.user ? (
              <>
                <Link href="/profile" className="rounded-full px-4 py-1.5 transition-colors hover:bg-white/10" style={{ color: "var(--posh-fg-muted)" }}>My Account</Link>
                <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="rounded-full px-4 py-1.5 transition-colors hover:bg-white/10" style={{ color: "var(--posh-fg-muted)" }}>Sign out</button>
              </>
            ) : (
              <Link href="/auth/login" className="rounded-full border px-4 py-1.5 transition-colors hover:bg-white/10" style={{ borderColor: "rgba(240,232,216,0.12)", color: "var(--posh-fg)" }}>Sign in</Link>
            )}
          </nav>
        </header>

        {/* ── Two-column body ── */}
        <div className="mt-8 flex flex-1 flex-col gap-6 lg:flex-row">

          {/* LEFT — rotating panel (recentOrders 7 s ↔ suggestions 7 s) */}
          <aside className="flex w-full flex-col rounded-[2rem] border p-7 backdrop-blur-xl lg:w-[340px] lg:shrink-0"
            style={{ background: "rgba(28,24,16,0.40)", borderColor: "rgba(240,232,216,0.10)" }}>

            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--posh-fg-muted)" }}>
                {panel === 0 ? "Recent Orders" : "AI Suggestions"}
              </p>
              {panel === 0
                ? <Link href="/orders" className="text-xs transition-opacity hover:opacity-70" style={{ color: "var(--posh-primary)" }}>View all orders →</Link>
                : <Link href="/sourcing" className="text-xs transition-opacity hover:opacity-70" style={{ color: "var(--posh-primary)" }}>Open AI sourcing →</Link>
              }
            </div>

            <div className="flex-1" style={{ opacity: fade ? 1 : 0, transition: "opacity 420ms ease" }}>
              {panel === 0 ? (
                <div className="divide-y" style={{ borderColor: "rgba(240,232,216,0.08)" }}>
                  {recentOrders.map((o) => (
                    <Link key={o.id} href="/orders" className="flex items-start justify-between gap-3 py-4 transition-colors hover:bg-white/5">
                      <div className="min-w-0">
                        <p className="truncate text-sm" style={{ color: "var(--posh-fg)" }}>{o.item}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--posh-fg-muted)" }}>{o.qty} · <span className="font-mono">{o.id}</span></p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="posh-heading text-base" style={{ color: "var(--posh-primary)" }}>{o.value}</p>
                        <p className="mt-0.5 text-[10px]" style={{ color: "var(--posh-fg-muted)" }}>{o.state}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(240,232,216,0.08)" }}>
                  {suggestions.map((s) => (
                    <div key={s.item} className="flex items-start justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="text-sm" style={{ color: "var(--posh-fg)" }}>{s.item}</p>
                        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--posh-fg-muted)" }}>{s.why}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="posh-heading text-base" style={{ color: "var(--posh-primary)" }}>{s.move}</p>
                        <p className="mt-0.5 font-mono text-[10px] font-semibold"
                          style={{ color: s.delta.startsWith("-") ? "#4ade80" : "#fbbf24" }}>{s.delta}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT — 4-tab section */}
          <section className="flex flex-1 flex-col rounded-[2rem] border p-7 backdrop-blur-xl md:p-10"
            style={{ background: "rgba(28,24,16,0.40)", borderColor: "rgba(240,232,216,0.10)" }}>
            <nav className="flex flex-wrap gap-2">
              {views.map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className="rounded-full border px-5 py-2 text-sm transition-colors duration-300"
                  style={view === v
                    ? { borderColor: "var(--posh-primary)", background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }
                    : { borderColor: "rgba(240,232,216,0.12)", color: "var(--posh-fg-muted)" }}>
                  {v}
                </button>
              ))}
            </nav>
            <div key={view} className="animate-rise mt-8 flex-1">

              {view === "Outstanding" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--posh-fg-muted)" }}>
                      <tr>
                        {["Order", "Material", "Supplier", "ETA", "Value", "Status"].map((h) => (
                          <th key={h} className="border-b pb-3 pr-6 font-normal" style={{ borderColor: "rgba(240,232,216,0.10)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {outstanding.map((r) => (
                        <tr key={r[0]} className="transition-colors hover:bg-white/5">
                          <td className="border-b py-4 pr-6" style={{ borderColor: "rgba(240,232,216,0.08)", color: "var(--posh-fg-muted)" }}>
                            <Link href="/orders" className="hover:underline" style={{ color: "var(--posh-primary)" }}>{r[0]}</Link>
                          </td>
                          <td className="border-b py-4 pr-6" style={{ borderColor: "rgba(240,232,216,0.08)", color: "var(--posh-fg)" }}>{r[1]}</td>
                          <td className="border-b py-4 pr-6" style={{ borderColor: "rgba(240,232,216,0.08)", color: "var(--posh-fg-muted)" }}>{r[2]}</td>
                          <td className="border-b py-4 pr-6" style={{ borderColor: "rgba(240,232,216,0.08)", color: "var(--posh-fg)" }}>{r[3]}</td>
                          <td className="posh-heading border-b py-4 pr-6 text-lg" style={{ borderColor: "rgba(240,232,216,0.08)", color: "var(--posh-primary)" }}>{r[4]}</td>
                          <td className="border-b py-4" style={{ borderColor: "rgba(240,232,216,0.08)", color: "var(--posh-fg-muted)" }}>{r[5]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Watchlist — 2-col card grid → /watchlist */}
              {view === "Watchlist" && (
                <div className="grid gap-px overflow-hidden rounded-[2rem] border sm:grid-cols-2"
                  style={{ borderColor: "rgba(240,232,216,0.10)", background: "rgba(240,232,216,0.10)" }}>
                  {watchlist.map((w) => (
                    <Link key={w[0]} href="/watchlist" className="block p-7 transition-colors hover:bg-[#241f16]"
                      style={{ background: "var(--posh-bg)" }}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-xl" style={{ color: "var(--posh-fg)" }}>{w[0]}</h3>
                        <span className="text-xs" style={{ color: "var(--posh-primary)" }}>{w[2]}</span>
                      </div>
                      <p className="posh-heading mt-3 text-3xl" style={{ color: "var(--posh-fg)" }}>{w[1]}</p>
                      <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{w[3]}</p>
                    </Link>
                  ))}
                </div>
              )}

              {/* Reports — 4-col KPI cards → /reports */}
              {view === "Reports" && (
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
                  {reports.map((r) => (
                    <Link key={r[0]} href="/reports"
                      className="block rounded-[2rem] border p-7 transition-colors hover:bg-white/5"
                      style={{ borderColor: "rgba(240,232,216,0.10)", background: "rgba(36,31,22,0.60)" }}>
                      <p className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--posh-fg-muted)" }}>{r[0]}</p>
                      <p className="posh-heading mt-5 text-4xl" style={{ color: "var(--posh-primary)" }}>{r[1]}</p>
                      <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{r[2]}</p>
                    </Link>
                  ))}
                </div>
              )}

              {/* Browse — category grid → /products?category={slug} */}
              {view === "Browse" && (
                <div className="grid gap-px overflow-hidden rounded-[2rem] border sm:grid-cols-2 xl:grid-cols-3"
                  style={{ borderColor: "rgba(240,232,216,0.10)", background: "rgba(240,232,216,0.10)" }}>
                  {browse.map((b) => (
                    <Link key={b[0]} href={`/products?category=${b[2]}`}
                      className="group block p-8 text-left transition-colors hover:bg-[#241f16]"
                      style={{ background: "var(--posh-bg)" }}>
                      <h3 className="text-2xl" style={{ color: "var(--posh-fg)" }}>{b[0]}</h3>
                      <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{b[1]}</p>
                      <span className="mt-6 inline-block text-sm transition-transform duration-500 group-hover:translate-x-1"
                        style={{ color: "var(--posh-primary)" }}>Browse →</span>
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
