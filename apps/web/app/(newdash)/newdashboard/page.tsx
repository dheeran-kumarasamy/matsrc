"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { Bell, ShoppingCart } from "lucide-react";
import { builderApiGet, builderApiPatch } from "@/lib/api";
import { useCartStore } from "@/lib/store/cart-store";
import { useOverlayStore } from "@/lib/store/overlay-store";

// ── Live-data types ───────────────────────────────────────────────────────────
type Order = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  total: number;
  itemCount: number;
  items?: Array<{ name: string }>;
  supplierName?: string;
  createdAt: string;
};

type WatchlistItem = {
  id: string;
  name: string;
  unit: string;
  basePrice: number;
  targetPrice: number | null;
  priceIntelligence?: {
    currentPricePerBaseUnit: number | null;
    gapToTargetPct: number | null;
  } | null;
};

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  orderId?: string | null;
};

// ── Static data (posh-web-flair suggestions + browse categories) ──────────────
const suggestions = [
  { item: "Binding Wire 18G",    why: "Reordered every 3 weeks · due now", move: "₹72,000/T",  delta: "+2.1%" },
  { item: "Shuttering Ply 18mm", why: "Pairs with your slab schedule",      move: "₹92/sqft",   delta: "+1.3%" },
  { item: "Fly Ash Bricks",      why: "12% under your last landed rate",    move: "₹6.4/nos",   delta: "-1.8%" },
  { item: "TMT Fe-550D · 16mm",  why: "Grade upgrade, same lead time",      move: "₹64,100/T",  delta: "+0.6%" },
  { item: "Curing Compound",     why: "Watchlist supplier cut price",        move: "₹210/L",     delta: "-3.4%" },
];

const browse = [
  ["Cement",          "18 grades", "cement"    ],
  ["Steel & TMT",     "42 SKUs",   "steel"     ],
  ["Aggregates",      "11 grades", "aggregates"],
  ["Blocks & Bricks", "26 SKUs",   "bricks"    ],
  ["Formwork",        "14 SKUs",   "formwork"  ],
  ["Finishes",        "60+ SKUs",  "finishes"  ],
];

const STATUS_LABELS: Record<string, string> = {
  PLACED: "Enquiry", PROCESSING: "Processing", DISPATCHED: "Dispatched",
  OUT_FOR_DELIVERY: "Out for Delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

const views = ["Outstanding", "Watchlist", "Reports", "Browse"] as const;
type View = (typeof views)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return diffDay < 7 ? `${diffDay}d ago` : new Date(dateString).toLocaleDateString("en-IN");
}

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

function gapLabel(pct: number | null): string {
  if (pct === null) return "—";
  return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NewDashboardPage() {
  const { data: session } = useSession();

  // Panel rotation (left column: orders ↔ suggestions)
  const [panel, setPanel] = useState(0);
  const [fade,  setFade]  = useState(true);
  const [view,  setView]  = useState<View>("Outstanding");

  // Live orders
  const [orders,      setOrders]      = useState<Order[]>([]);
  const [ordersReady, setOrdersReady] = useState(false);

  // Live watchlist
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistReady, setWatchlistReady] = useState(false);

  // Live notifications (alerts)
  const [notifs,       setNotifs]       = useState<NotificationItem[]>([]);
  const [unreadCount,  setUnreadCount]  = useState(0);
  const [notifsOpen,   setNotifsOpen]   = useState(false);
  const [notifsLoaded, setNotifsLoaded] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  // Cart (Zustand store — shared with CartDrawer)
  const cartCount = useCartStore((s) => s.summary.itemCount);
  const hasLoaded = useCartStore((s) => s.hasLoaded);
  const fetchCart = useCartStore((s) => s.fetchCart);
  const openCart  = useOverlayStore((s) => s.openCart);

  // ── Boot: fetch cart + orders + watchlist in parallel ──────────────────────
  useEffect(() => {
    if (!hasLoaded) void fetchCart();

    builderApiGet<Order[]>("/orders")
      .then((d) => { setOrders(d); setOrdersReady(true); })
      .catch(() => setOrdersReady(true));

    builderApiGet<WatchlistItem[]>("/watchlist")
      .then((d) => { setWatchlistItems(d); setWatchlistReady(true); })
      .catch(() => setWatchlistReady(true));
  }, [hasLoaded, fetchCart]);

  // ── Notifications: fetch + 30 s poll ───────────────────────────────────────
  const fetchNotifs = useCallback(() => {
    builderApiGet<{ items: NotificationItem[]; unreadCount: number }>("/notifications")
      .then((d) => { setNotifs(d.items ?? []); setUnreadCount(d.unreadCount ?? 0); setNotifsLoaded(true); })
      .catch(() => setNotifsLoaded(true));
  }, []);

  useEffect(() => {
    fetchNotifs();
    const id = setInterval(fetchNotifs, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifs]);

  useEffect(() => { if (notifsOpen) fetchNotifs(); }, [notifsOpen, fetchNotifs]);

  // Close bell dropdown on outside click
  useEffect(() => {
    if (!notifsOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setNotifsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifsOpen]);

  // Mark single notification as read
  const markRead = async (item: NotificationItem) => {
    if (item.read) return;
    setNotifs((prev) => prev.map((n) => n.id === item.id ? { ...n, read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
    try { await builderApiPatch(`/notifications/${item.id}`, { read: true }); } catch { /* best-effort */ }
  };

  // Mark all notifications as read
  const markAllRead = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await Promise.all(
        notifs.filter((n) => !n.read).map((n) => builderApiPatch(`/notifications/${n.id}`, { read: true }))
      );
    } catch { /* best-effort */ }
  };

  // ── Auto-rotate left panel every 7 s ───────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setPanel((p) => (p === 0 ? 1 : 0)); setFade(true); }, 420);
    }, 7000);
    return () => clearInterval(t);
  }, []);

  // Derived data for tabs
  const recentOrders  = orders.slice(0, 5);
  const activeOrders  = orders.filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status));
  const reportMetrics = [
    ["Active Orders",   String(activeOrders.length),     "Orders in progress"      ],
    ["Cart Items",      String(cartCount),                "Items ready to enquire"  ],
    ["Watchlist",       String(watchlistItems.length),    "Materials being tracked"  ],
    ["Delivered",       String(orders.filter((o) => o.status === "DELIVERED").length), "Successfully delivered"],
  ];

  const navLinks = [
    { href: "/newdashboard", label: "Dashboard" },
    { href: "/orders",       label: "Orders"    },
    { href: "/watchlist",    label: "Watchlist" },
    { href: "/reports",      label: "Reports"   },
    { href: "/products",     label: "Browse"    },
  ];

  const FG  = "var(--posh-fg)";
  const FM  = "var(--posh-fg-muted)";
  const P   = "var(--posh-primary)";
  const PFG = "var(--posh-primary-fg)";
  const B60 = "rgba(240,232,216,0.10)";
  const B40 = "rgba(240,232,216,0.08)";
  const B12 = "rgba(240,232,216,0.12)";

  return (
    <main className="relative min-h-screen overflow-hidden" style={{ background: "var(--posh-bg)" }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--posh-gradient-warm)" }} />
      <div className="relative mx-auto flex min-h-screen max-w-[110rem] flex-col px-6 py-6 md:px-10 md:py-8">

        {/* ── Header ── */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex shrink-0 items-center gap-3">
            <Link href="/" className="posh-heading text-2xl tracking-tight" style={{ color: FG }}>Buildohub</Link>
            <span className="hidden text-xs tracking-[0.2em] sm:block" style={{ color: FM }}>Procurement Desk</span>
          </div>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href} className="rounded-full px-4 py-1.5 transition-colors hover:bg-white/10" style={{ color: FM }}>{label}</Link>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {/* Cart */}
            <button type="button" onClick={() => openCart("review")} aria-label="Open cart"
              className="relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-white/10"
              style={{ borderColor: B12, color: FM }}>
              <ShoppingCart size={15} />
              <span className="hidden sm:inline">Cart</span>
              {cartCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-bold" style={{ background: P, color: PFG }}>
                  {cartCount}
                </span>
              )}
            </button>
            {/* Bell — live alerts dropdown */}
            <div className="relative" ref={bellRef}>
              <button type="button" onClick={() => setNotifsOpen((o) => !o)} aria-label="Alerts"
                className="relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-white/10"
                style={{ borderColor: B12, color: FM }}>
                <Bell size={15} />
                <span className="hidden sm:inline">Alerts</span>
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {notifsOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border shadow-2xl"
                  style={{ background: "var(--posh-bg-card)", borderColor: B60 }}>
                  <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: B40 }}>
                    <p className="text-sm font-semibold" style={{ color: FG }}>Alerts</p>
                    {unreadCount > 0 && <button type="button" onClick={markAllRead} className="text-xs transition-opacity hover:opacity-70" style={{ color: P }}>Mark all read</button>}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {!notifsLoaded ? (
                      <p className="px-4 py-6 text-center text-xs" style={{ color: FM }}>Loading…</p>
                    ) : notifs.length === 0 ? (
                      <div className="px-4 py-8 text-center"><p className="text-sm" style={{ color: FM }}>You&apos;re all caught up.</p></div>
                    ) : (
                      <ul>
                        {notifs.map((n) => (
                          <li key={n.id}>
                            <button type="button" onClick={() => markRead(n)}
                              className="flex w-full gap-2.5 border-b px-4 py-3 text-left transition hover:bg-white/5"
                              style={{ borderColor: B40, background: !n.read ? "rgba(196,145,90,0.08)" : "transparent" }}>
                              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "opacity-0" : ""}`} style={{ background: P }} />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium" style={{ color: n.read ? FM : FG }}>{n.title}</p>
                                <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: FM }}>{n.body}</p>
                                <p className="mt-1 text-[11px]" style={{ color: FM }}>{timeAgo(n.createdAt)}</p>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
            <span className="mx-1 hidden opacity-20 sm:block" style={{ color: FG }}>|</span>
            {session?.user ? (
              <>
                <Link href="/profile" className="hidden rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-white/10 sm:block" style={{ color: FM }}>Account</Link>
                <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="hidden rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-white/10 sm:block" style={{ color: FM }}>Sign out</button>
              </>
            ) : (
              <Link href="/auth/login" className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-white/10" style={{ borderColor: B12, color: FG }}>Sign in</Link>
            )}
          </div>
        </header>

        {/* ── Two-column body ── */}
        <div className="mt-8 flex flex-1 flex-col gap-6 lg:flex-row">

          {/* LEFT — rotating panel: live recentOrders (0) ↔ suggestions (1) */}
          <aside className="flex w-full flex-col rounded-[2rem] border p-7 backdrop-blur-xl lg:w-[340px] lg:shrink-0"
            style={{ background: "rgba(28,24,16,0.40)", borderColor: B60 }}>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em]" style={{ color: FM }}>
                {panel === 0 ? "Recent Orders" : "AI Suggestions"}
              </p>
              {panel === 0
                ? <Link href="/orders" className="text-xs transition-opacity hover:opacity-70" style={{ color: P }}>View all →</Link>
                : <Link href="/sourcing" className="text-xs transition-opacity hover:opacity-70" style={{ color: P }}>Open AI sourcing →</Link>
              }
            </div>
            <div className="flex-1" style={{ opacity: fade ? 1 : 0, transition: "opacity 420ms ease" }}>
              {panel === 0 ? (
                /* Live orders */
                <div className="divide-y" style={{ borderColor: B40 }}>
                  {!ordersReady ? (
                    <p className="py-8 text-center text-xs" style={{ color: FM }}>Loading orders…</p>
                  ) : recentOrders.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-sm" style={{ color: FM }}>No orders yet.</p>
                      <Link href="/products" className="mt-2 inline-block text-xs transition-opacity hover:opacity-70" style={{ color: P }}>Browse materials →</Link>
                    </div>
                  ) : recentOrders.map((o) => (
                    <Link key={o.id} href={`/orders/${o.id}`}
                      className="flex items-start justify-between gap-3 py-4 transition-colors hover:bg-white/5">
                      <div className="min-w-0">
                        <p className="truncate text-sm" style={{ color: FG }}>{o.items?.[0]?.name ?? `Order #${o.id.slice(0,6)}`}{(o.itemCount??0) > 1 ? ` +${o.itemCount-1}` : ""}</p>
                        <p className="mt-0.5 text-xs" style={{ color: FM }}>{o.supplierName ?? STATUS_LABELS[o.status] ?? o.status}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="posh-heading text-base" style={{ color: P }}>{fmtInr(o.total)}</p>
                        <p className="mt-0.5 text-[10px]" style={{ color: FM }}>{STATUS_LABELS[o.status]}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                /* Static AI suggestions */
                <div className="divide-y" style={{ borderColor: B40 }}>
                  {suggestions.map((s) => (
                    <div key={s.item} className="flex items-start justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="text-sm" style={{ color: FG }}>{s.item}</p>
                        <p className="mt-1 text-xs leading-relaxed" style={{ color: FM }}>{s.why}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="posh-heading text-base" style={{ color: P }}>{s.move}</p>
                        <p className="mt-0.5 font-mono text-[10px] font-semibold"
                          style={{ color: s.delta.startsWith("-") ? "#4ade80" : "#fbbf24" }}>{s.delta}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT — tabs */}
          <section className="flex flex-1 flex-col rounded-[2rem] border p-7 backdrop-blur-xl md:p-10"
            style={{ background: "rgba(28,24,16,0.40)", borderColor: B60 }}>
            <nav className="flex flex-wrap gap-2">
              {views.map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className="rounded-full border px-5 py-2 text-sm transition-colors duration-300"
                  style={view === v ? { borderColor: P, background: P, color: PFG } : { borderColor: B12, color: FM }}>
                  {v}
                </button>
              ))}
            </nav>
            <div key={view} className="animate-rise mt-8 flex-1">

              {/* Outstanding — live orders */}
              {view === "Outstanding" && (
                <div className="overflow-x-auto">
                  {!ordersReady ? <p className="py-8 text-center text-xs" style={{ color: FM }}>Loading…</p> :
                  activeOrders.length === 0 ? (
                    <div className="py-12 text-center">
                      <p className="text-sm" style={{ color: FM }}>No outstanding orders.</p>
                      <Link href="/products" className="mt-2 inline-block text-xs hover:opacity-70" style={{ color: P }}>Browse materials →</Link>
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-[0.2em]" style={{ color: FM }}>
                        <tr>{["Order","Material","Supplier","Total","Status"].map((h) => (
                          <th key={h} className="border-b pb-3 pr-6 font-normal" style={{ borderColor: B60 }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {activeOrders.map((o) => (
                          <tr key={o.id} className="transition-colors hover:bg-white/5">
                            <td className="border-b py-4 pr-6" style={{ borderColor: B40 }}>
                              <Link href={`/orders/${o.id}`} className="font-mono text-xs hover:underline" style={{ color: P }}>{o.id.slice(0,8)}</Link>
                            </td>
                            <td className="border-b py-4 pr-6" style={{ borderColor: B40, color: FG }}>{o.items?.[0]?.name ?? "—"}{(o.itemCount??0)>1?` +${o.itemCount-1}`:""}</td>
                            <td className="border-b py-4 pr-6" style={{ borderColor: B40, color: FM }}>{o.supplierName ?? "—"}</td>
                            <td className="posh-heading border-b py-4 pr-6 text-lg" style={{ borderColor: B40, color: P }}>{fmtInr(o.total)}</td>
                            <td className="border-b py-4" style={{ borderColor: B40, color: FM }}>{STATUS_LABELS[o.status]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Watchlist — live */}
              {view === "Watchlist" && (
                !watchlistReady ? <p className="py-8 text-center text-xs" style={{ color: FM }}>Loading…</p> :
                watchlistItems.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm" style={{ color: FM }}>No items in watchlist.</p>
                    <Link href="/products" className="mt-2 inline-block text-xs hover:opacity-70" style={{ color: P }}>Browse & watchlist materials →</Link>
                  </div>
                ) : (
                  <div className="grid gap-px overflow-hidden rounded-[2rem] border sm:grid-cols-2"
                    style={{ borderColor: B60, background: B60 }}>
                    {watchlistItems.map((w) => (
                      <Link key={w.id} href="/watchlist" className="block p-7 transition-colors hover:bg-[#241f16]"
                        style={{ background: "var(--posh-bg)" }}>
                        <div className="flex items-baseline justify-between">
                          <h3 className="text-xl" style={{ color: FG }}>{w.name}</h3>
                          <span className="text-xs" style={{ color: P }}>{gapLabel(w.priceIntelligence?.gapToTargetPct ?? null)}</span>
                        </div>
                        <p className="posh-heading mt-3 text-3xl" style={{ color: FG }}>
                          {w.priceIntelligence?.currentPricePerBaseUnit ? fmtInr(w.priceIntelligence.currentPricePerBaseUnit) : fmtInr(w.basePrice)} / {w.unit}
                        </p>
                        <p className="mt-2 text-sm" style={{ color: FM }}>{w.targetPrice ? `Target: ${fmtInr(w.targetPrice)}` : "No target set"}</p>
                      </Link>
                    ))}
                  </div>
                )
              )}

              {/* Reports — live metrics */}
              {view === "Reports" && (
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
                  {reportMetrics.map(([label, value, sub]) => (
                    <Link key={label} href="/reports"
                      className="block rounded-[2rem] border p-7 transition-colors hover:bg-white/5"
                      style={{ borderColor: B60, background: "rgba(36,31,22,0.60)" }}>
                      <p className="text-xs uppercase tracking-[0.25em]" style={{ color: FM }}>{label}</p>
                      <p className="posh-heading mt-5 text-4xl" style={{ color: P }}>{value}</p>
                      <p className="mt-2 text-sm" style={{ color: FM }}>{sub}</p>
                    </Link>
                  ))}
                </div>
              )}

              {/* Browse — category tiles */}
              {view === "Browse" && (
                <div className="grid gap-px overflow-hidden rounded-[2rem] border sm:grid-cols-2 xl:grid-cols-3"
                  style={{ borderColor: B60, background: B60 }}>
                  {browse.map((b) => (
                    <Link key={b[0]} href={`/products?category=${b[2]}`}
                      className="group block p-8 text-left transition-colors hover:bg-[#241f16]"
                      style={{ background: "var(--posh-bg)" }}>
                      <h3 className="text-2xl" style={{ color: FG }}>{b[0]}</h3>
                      <p className="mt-2 text-sm" style={{ color: FM }}>{b[1]}</p>
                      <span className="mt-6 inline-block text-sm transition-transform duration-500 group-hover:translate-x-1" style={{ color: P }}>Browse →</span>
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
