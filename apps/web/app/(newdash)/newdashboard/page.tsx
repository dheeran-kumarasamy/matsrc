"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { builderApiGet } from "@/lib/api";
import { useCartStore } from "@/lib/store/cart-store";
import { useOverlayStore } from "@/lib/store/overlay-store";
import AppHeader from "@/components/shared/AppHeader";
import { getFirstName } from "@/lib/user-display";

// ── Live-data types ───────────────────────────────────────────────────────────
type Order = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  total: number;
  itemCount: number;
  items?: Array<{ name: string }>;
  supplierName?: string;
  siteName?: string;
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

// ── Static data (posh-web-flair suggestions + browse categories) ──────────────
const suggestions = [
  { item: "Binding Wire 18G",    why: "Reordered every 3 weeks · due now", move: "₹72,000/T",  delta: "+2.1%" },
  { item: "Shuttering Ply 18mm", why: "Pairs with your slab schedule",      move: "₹92/sqft",   delta: "+1.3%" },
  { item: "Fly Ash Bricks",      why: "12% under your last landed rate",    move: "₹6.4/nos",   delta: "-1.8%" },
  { item: "TMT Fe-550D · 16mm",  why: "Grade upgrade, same lead time",      move: "₹64,100/T",  delta: "+0.6%" },
  { item: "Curing Compound",     why: "Watchlist supplier cut price",        move: "₹210/L",     delta: "-3.4%" },
];

const STATUS_LABELS: Record<string, string> = {
  PLACED: "Enquiry", PROCESSING: "Processing", DISPATCHED: "Dispatched",
  OUT_FOR_DELIVERY: "Out for Delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtOrderDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function gapLabel(pct: number | null): string {
  if (pct === null) return "—";
  return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NewDashboardPage() {
  const { data: session } = useSession();

  // First-name-only greeting text ("Dheeran Kumarasamy" -> "Dheeran"),
  // derived dynamically from the authenticated profile via the same shared
  // helper the top-navigation ProfileMenu uses (lib/user-display.ts) — so
  // the welcome heading and the header profile control never disagree.
  const firstName = session?.user ? getFirstName(session.user.name, session.user.email, "") : "";

  // Segmented AI Suggestions / Recent Orders menu — user-controlled only
  // (see `panels`/`PanelKind` below): only these two options exist, and the
  // user manually clicks between them. There is no automatic rotation/timer
  // — the panel only changes when the user clicks a tab. This is a purely
  // client-side content swap: both panels' data is already loaded (orders
  // fetched on mount below; suggestions are static), so switching tabs never
  // triggers a refetch.
  const [panelIndex, setPanelIndex] = useState(0);

  // Live orders
  const [orders,      setOrders]      = useState<Order[]>([]);
  const [ordersReady, setOrdersReady] = useState(false);

  // Live watchlist
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistReady, setWatchlistReady] = useState(false);

  // Cart (Zustand store — shared with CartDrawer)
  const cartCount = useCartStore((s) => s.summary.itemCount);
  const hasLoaded = useCartStore((s) => s.hasLoaded);
  const fetchCart = useCartStore((s) => s.fetchCart);
  const openCart  = useOverlayStore((s) => s.openCart);

  // ── Boot: fetch cart + orders + watchlist in parallel ──────────────────────
  // Notifications/alerts and the profile menu are no longer fetched/managed
  // here — both now live in the shared AppHeader (NotificationBell.tsx /
  // ProfileMenu.tsx), the same components every other page uses, so there is
  // a single implementation instead of a /newdashboard-only duplicate.
  useEffect(() => {
    if (!hasLoaded) void fetchCart();

    builderApiGet<Order[]>("/orders")
      .then((d) => { setOrders(d); setOrdersReady(true); })
      .catch(() => setOrdersReady(true));

    builderApiGet<WatchlistItem[]>("/watchlist")
      .then((d) => { setWatchlistItems(d); setWatchlistReady(true); })
      .catch(() => setWatchlistReady(true));
  }, [hasLoaded, fetchCart]);

  // Derived data — reused by both the segmented panel and the stat cards
  // below (no duplicate fetch/calculation: same `orders`/`watchlistItems`/
  // `cartCount` state populated once above).
  const recentOrders = orders.slice(0, 5);

  // "Active Orders" = every order NOT Cancelled or Delivered. "Closed" is
  // not currently a distinct OrderStatus in the data model (only
  // PLACED/PROCESSING/DISPATCHED/OUT_FOR_DELIVERY/DELIVERED/CANCELLED
  // exist -- see packages/db/prisma/schema.prisma). This mirrors the exact
  // same translation applied server-side in
  // apps/web/app/api/builder/orders/route.ts for `?status=ACTIVE`.
  const activeOrders = orders.filter((o) => !["CANCELLED", "DELIVERED"].includes(o.status));
  // "Delivered Orders" = Delivered only (see apps/web/app/(builder)/orders/page.tsx).
  const deliveredOrders = orders.filter((o) => o.status === "DELIVERED");

  // Which stat's preview (if any) is currently expanded inline on the
  // dashboard. Clicking a stat card toggles this instead of navigating
  // away immediately — the actual "View All" link inside the preview is
  // the only thing that navigates to /orders?status=... or /watchlist.
  // Clicking the same card again collapses the preview.
  type StatPreviewKind = "ACTIVE" | "DELIVERED" | "WATCHLIST";
  const [selectedStat, setSelectedStat] = useState<StatPreviewKind | null>(null);

  function toggleStat(kind: StatPreviewKind) {
    setSelectedStat((prev) => (prev === kind ? null : kind));
  }

  // Reports/statistics -- the same metrics previously shown only behind the
  // "Reports" tab, now surfaced directly on the dashboard. Each card
  // reuses the app's existing navigation/overlay mechanisms rather than
  // duplicating any business logic:
  //  - Active Orders / Delivered Orders -> reveal an inline preview (below)
  //    of the same `orders` data already fetched above, using the exact
  //    same ACTIVE/DELIVERED criteria as apps/web/app/api/builder/orders/route.ts.
  //    "View All Orders" inside the preview navigates to /orders?status=...
  //  - Watchlist -> reveals an inline preview of the same live
  //    `watchlistItems` state already fetched above; "View All" navigates
  //    to the existing /watchlist route.
  //  - Cart Items -> the existing shared live cart drawer (Zustand overlay
  //    store), not a separate/fake cart preview.
  const statCards = [
    {
      id: "ACTIVE" as const,
      label: "Active Orders",
      value: String(activeOrders.length),
      sub: "Orders in progress",
      onClick: () => toggleStat("ACTIVE"),
    },
    {
      id: "DELIVERED" as const,
      label: "Delivered Orders",
      value: String(deliveredOrders.length),
      sub: "Delivered",
      onClick: () => toggleStat("DELIVERED"),
    },
    {
      id: "WATCHLIST" as const,
      label: "Watchlist",
      value: String(watchlistItems.length),
      sub: "Materials being tracked",
      onClick: () => toggleStat("WATCHLIST"),
    },
    {
      id: "CART" as const,
      label: "Cart Items",
      value: String(cartCount),
      sub: "Items ready to enquire",
      onClick: () => openCart("review"),
    },
  ];

  // Inline preview data — reuses the exact same `activeOrders` /
  // `deliveredOrders` / `watchlistItems` derived above (no duplicate
  // fetch/filter logic), sliced to the latest 5. `orders` is already
  // sorted most-recent-first by the API (orderBy: createdAt desc — see
  // apps/web/app/api/builder/orders/route.ts), matching the same
  // "most recent" logic used by the Recent Orders panel's `recentOrders`.
  const activeOrdersPreview = activeOrders.slice(0, 5);
  const deliveredOrdersPreview = deliveredOrders.slice(0, 5);
  const watchlistPreview = watchlistItems.slice(0, 5);

  const PREVIEW_TITLES: Record<StatPreviewKind, string> = {
    ACTIVE: "Active Orders",
    DELIVERED: "Delivered Orders",
    WATCHLIST: "Watchlist",
  };
  // Exact destination URLs required by spec — same status query the
  // /orders page and its API route already understand (see
  // apps/web/app/(builder)/orders/page.tsx and
  // apps/web/app/api/builder/orders/route.ts's resolveStatusWhere()).
  const PREVIEW_VIEW_ALL_HREF: Record<StatPreviewKind, string> = {
    ACTIVE: "/orders?status=ACTIVE",
    DELIVERED: "/orders?status=DELIVERED",
    WATCHLIST: "/watchlist",
  };

  // ── Left-column panel — exactly two user-selectable options ─────────────────
  // Only "AI Suggestions" and "Recent Orders" are shown. There is no
  // automatic rotation/timer of any kind — the panel changes only when the
  // user clicks one of the two tabs below (manual control only).
  type PanelKind = "suggestions" | "orders";
  const PANEL_LABELS: Record<PanelKind, string> = {
    suggestions: "AI Suggestions",
    orders: "Recent Orders",
  };
  const panels = useMemo<PanelKind[]>(() => ["suggestions", "orders"], []);

  const activePanel: PanelKind = panels[panelIndex] ?? "suggestions";

  // ── Posh design tokens ─────────────────────────────────────────────────────
  // Ported to the same warm dark editorial --posh-* palette used by the
  // marketing homepage and every other authenticated page (posh-web-flair
  // parity), replacing the previous monochrome black/white aliases. Kept as
  // constants so the JSX below needs minimal churn.
  const FG  = "var(--posh-fg)";               // primary ink
  const FM  = "var(--posh-fg-muted)";         // muted ink
  const B60 = "var(--posh-border)";           // card border
  const B40 = "var(--posh-border)";           // hairline divider
  const CARD = "var(--posh-bg-card)";         // card surface

  return (
    <main className="posh-body relative min-h-screen overflow-hidden bg-[color:var(--posh-bg-card)]">
      <div className="relative mx-auto flex min-h-screen max-w-[110rem] flex-col px-6 py-6 md:px-10 md:py-8">

        {/* ── Header ── standardized on the shared AppHeader (search ->
            Cart -> Alerts -> Reports -> Profile), the same single-source-
            of-truth component used by every other page's top navigation
            (see app/(builder)/layout.tsx). /newdashboard has no persistent
            sidebar to carry the wordmark, so it renders the logo inline
            via `showLogo`. */}
        <AppHeader className="flex items-center justify-between gap-4" showLogo />

        {/* ── Welcome heading ── first-name-only, dynamically derived from
            the authenticated profile via the same lib/user-display.ts
            helper the shared ProfileMenu uses (single source of truth —
            see `firstName` above). */}
        <div className="mt-6">
          <p className="posh-eyebrow">Procurement Desk</p>
          <h1 className="posh-page-title mt-2 text-3xl">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h1>
          {/* Browse Materials / Open AI Agent — same row, horizontally
              aligned, wrapping gracefully on narrow screens. Both are plain
              links to existing routes (/products, /sourcing) — no new
              functionality, reusing the same posh-btn-* button styles used
              elsewhere on this page. */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/products"
              className="posh-btn-solid inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-bold"
            >
              Browse Materials
            </Link>
            <Link
              href="/sourcing"
              className="posh-btn-ghost inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-bold"
            >
              Open AI Agent
            </Link>
          </div>
        </div>

        {/* ── Dashboard statistics — the same live metrics previously shown
            only behind the "Reports" tab, now surfaced directly on the
            dashboard (spec section 3). Active Orders / Delivered Orders /
            Watchlist / Cart Items are all clickable (spec sections 7–10),
            each reusing an existing route/overlay rather than duplicating
            data-fetching or business logic. */}
        {/* Stat card height reduced ~50% — rounded-[2rem] p-7 + mt-5 (before
            the value) + text-4xl was mostly blank card padding, not content.
            Now rounded-2xl p-4 with a tight mt-2 before a smaller text-2xl
            value; still fully readable and the whole card remains a large
            click target. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => {
            const isPreviewable = card.id !== "CART";
            const isSelected = isPreviewable && selectedStat === card.id;
            return (
              <button
                key={card.label}
                type="button"
                aria-pressed={isPreviewable ? isSelected : undefined}
                onClick={card.onClick}
                className="block rounded-2xl border p-4 text-left transition-colors hover:bg-[rgba(var(--posh-wash-rgb),0.03)]"
                style={{
                  background: isSelected ? "rgba(var(--posh-wash-rgb),0.06)" : CARD,
                  borderColor: isSelected ? "var(--posh-primary)" : B60,
                }}
              >
                <p className="posh-eyebrow">{card.label}</p>
                <p className="posh-page-title mt-2 text-2xl">{card.value}</p>
                <p className="posh-subtitle mt-1">{card.sub}</p>
              </button>
            );
          })}
        </div>
        {/* ── Inline stat preview — expands directly on /newdashboard when a
            previewable stat card (Active Orders / Delivered Orders /
            Watchlist) is clicked, without navigating away (spec sections
            1–7). Reuses the exact same `orders`/`watchlistItems` state
            already fetched above; "View All"/"View All Orders" is the only
            control that navigates, to the exact URLs the spec requires. */}
        {selectedStat && (
          <section
            className="mt-4 rounded-2xl border p-5 shadow-sm md:p-6"
            style={{ background: CARD, borderColor: B60 }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="posh-eyebrow">Previewing</p>
                <h2 className="posh-card-title mt-1 text-xl">{PREVIEW_TITLES[selectedStat]}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStat(null)}
                className="posh-link text-xs"
                aria-label="Close preview"
              >
                Close ✕
              </button>
            </div>

            <div className="mt-6">
              {(selectedStat === "ACTIVE" || selectedStat === "DELIVERED") && (
                !ordersReady ? (
                  <p className="posh-muted py-8 text-center text-xs">Loading…</p>
                ) : (() => {
                    const list = selectedStat === "ACTIVE" ? activeOrdersPreview : deliveredOrdersPreview;
                    if (list.length === 0) {
                      return (
                        <div className="py-12 text-center">
                          <p className="posh-card-title">
                            {selectedStat === "ACTIVE" ? "No active orders" : "No delivered orders"}
                          </p>
                          <Link href="/products" className="posh-link mt-3 inline-block">
                            Browse materials →
                          </Link>
                        </div>
                      );
                    }
                    return (
                      <>
                        {/* Same required column order as the Recent Orders
                            list above: Site Name, Order Number, Date, Total
                            Amount. */}
                        <div className="divide-y" style={{ borderColor: B40 }}>
                          {list.map((o) => (
                            <Link
                              key={o.id}
                              href={`/orders/${o.id}`}
                              className="flex items-start justify-between gap-3 py-2.5 transition-colors hover:bg-[rgba(var(--posh-wash-rgb),0.03)]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold" style={{ color: FG }}>{o.siteName ?? "Unassigned"}</p>
                                <p className="posh-label mt-0.5">#{o.id.slice(0, 8)} · {fmtOrderDate(o.createdAt)}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="posh-card-title text-base">{fmtInr(o.total)}</p>
                                <p className="posh-label mt-0.5">{STATUS_LABELS[o.status]}</p>
                              </div>
                            </Link>
                          ))}
                        </div>
                        <Link
                          href={PREVIEW_VIEW_ALL_HREF[selectedStat]}
                          className="posh-btn-solid mt-5 flex items-center justify-center rounded-full py-2.5 text-sm font-bold"
                        >
                          View All Orders
                        </Link>
                      </>
                    );
                  })()
              )}

              {selectedStat === "WATCHLIST" && (
                !watchlistReady ? (
                  <p className="posh-muted py-8 text-center text-xs">Loading…</p>
                ) : watchlistPreview.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="posh-card-title">No items in watchlist</p>
                    <Link href="/products" className="posh-link mt-3 inline-block">
                      Browse &amp; watchlist materials →
                    </Link>
                  </div>
                ) : (
                  <>
                    <div
                      className="grid gap-px overflow-hidden rounded-[2rem] border sm:grid-cols-2"
                      style={{ borderColor: B60, background: B60 }}
                    >
                      {watchlistPreview.map((w) => (
                        <Link
                          key={w.id}
                          href="/watchlist"
                          className="block bg-[color:var(--posh-bg-card)] p-7 transition-colors hover:bg-[rgba(var(--posh-wash-rgb),0.03)]"
                        >
                          <div className="flex items-baseline justify-between">
                            <h3 className="posh-card-title">{w.name}</h3>
                            <span className="posh-label">{gapLabel(w.priceIntelligence?.gapToTargetPct ?? null)}</span>
                          </div>
                          <p className="posh-page-title mt-3">
                            {w.priceIntelligence?.currentPricePerBaseUnit
                              ? fmtInr(w.priceIntelligence.currentPricePerBaseUnit)
                              : fmtInr(w.basePrice)}{" "}
                            / {w.unit}
                          </p>
                          <p className="posh-subtitle mt-2">
                            {w.targetPrice ? `Target: ${fmtInr(w.targetPrice)}` : "No target set"}
                          </p>
                        </Link>
                      ))}
                    </div>
                    <Link
                      href={PREVIEW_VIEW_ALL_HREF.WATCHLIST}
                      className="posh-btn-solid mt-5 flex items-center justify-center rounded-full py-2.5 text-sm font-bold"
                    >
                      View All
                    </Link>
                  </>
                )
              )}
            </div>
          </section>
        )}

        {/* ── Two-column body ── */}
        <div className="mt-6 flex flex-1 flex-col gap-4 lg:flex-row">

          {/* LEFT — exactly two user-selectable panels: "AI Suggestions" and
              "Recent Orders". No automatic rotation/timer — the panel only
              changes when the user clicks one of the two tabs below. */}
          {/* Container padding/gap tightened (p-7 → p-5, mb-5 tab-row gap →
              mb-3) plus each line item below reduced from py-4 to py-2.5 —
              together this lets roughly 5 line items occupy the vertical
              space the previous 4 items needed. */}
          <aside className="flex w-full flex-col rounded-2xl border p-5 shadow-sm lg:w-[340px] lg:shrink-0"
            style={{ background: CARD, borderColor: B60 }}>
            {/* Swappable segmented menu — AI Suggestions / Recent Orders.
                This reads as one segmented control, not two unrelated CTA
                buttons: the selected option is olive (hovering to
                charcoal) and the unselected option is charcoal (hovering
                to olive), so the pair visually swaps colour on hover
                (see .posh-tab-selected / .posh-tab-unselected in
                globals.css). Manual toggle only — clicking a tab is the
                only way the panel changes; there is no auto-advance. */}
            <div role="tablist" aria-label="Dashboard panel" className="mb-3 flex gap-2">
              {panels.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={activePanel === p}
                  onClick={() => setPanelIndex(panels.indexOf(p))}
                  className={activePanel === p ? "posh-tab-selected" : "posh-tab-unselected"}
                >
                  {PANEL_LABELS[p]}
                </button>
              ))}
            </div>
            <div className="flex-1">
              {activePanel === "orders" && (
                /* Live orders — last 5, with "View All" moved to the
                   bottom of the list (spec section 6). */
                !ordersReady ? (
                  <p className="posh-muted py-8 text-center text-xs">Loading…</p>
                ) : recentOrders.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="posh-card-title">No recent orders</p>
                    <Link href="/products" className="posh-link mt-3 inline-block">Browse materials →</Link>
                  </div>
                ) : (
                  <>
                    {/* Columns in the required order: Site Name, Order
                        Number, Date, Total Amount. Same underlying `orders`
                        data/fields (siteName, id, createdAt, total) — no
                        business logic changed, only which fields render and
                        in what order. */}
                    <div className="divide-y" style={{ borderColor: B40 }}>
                      {recentOrders.map((o) => (
                        <Link key={o.id} href={`/orders/${o.id}`}
                          className="flex items-start justify-between gap-3 py-2.5 transition-colors hover:bg-[rgba(var(--posh-wash-rgb),0.03)]">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold" style={{ color: FG }}>{o.siteName ?? "Unassigned"}</p>
                            <p className="posh-label mt-0.5">#{o.id.slice(0, 8)} · {fmtOrderDate(o.createdAt)}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="posh-card-title text-base">{fmtInr(o.total)}</p>
                            <p className="posh-label mt-0.5">{STATUS_LABELS[o.status]}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                    <Link
                      href="/orders"
                      className="posh-btn-solid mt-3 flex items-center justify-center rounded-full py-2.5 text-sm font-bold"
                    >
                      View All
                    </Link>
                  </>
                )
              )}

              {activePanel === "suggestions" && (
                /* Static AI suggestions, with "Open AI Agent" (renamed from
                   "Open AI Sourcing" — label only, same /sourcing link and
                   functionality) at the bottom of the list. */
                <>
                  <div className="divide-y" style={{ borderColor: B40 }}>
                    {suggestions.map((s) => (
                      <div key={s.item} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-bold" style={{ color: FG }}>{s.item}</p>
                          <p className="mt-0.5 text-xs font-medium leading-relaxed" style={{ color: FM }}>{s.why}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="posh-card-title text-base">{s.move}</p>
                          {/* Direction is carried by weight/opacity, not colour. */}
                          <p className={`mt-0.5 font-mono text-[10px] font-bold ${s.delta.startsWith("-") ? "text-[color:var(--posh-fg)]" : "text-[color:var(--posh-fg-muted)]"}`}>
                            {s.delta}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link
                    href="/sourcing"
                    className="posh-btn-solid mt-3 flex items-center justify-center rounded-full py-2.5 text-sm font-bold"
                  >
                    Open AI Agent
                  </Link>
                </>
              )}
            </div>
          </aside>

          {/* RIGHT — Watchlist preview, reusing the live watchlist data
              already fetched above. Clicking through goes to the full
              /watchlist page (spec section 9); the standalone "Watchlist"
              action button has been removed. */}
          {/* Container padding trimmed (p-7/p-10 → p-5/p-6) as part of the
              overall page-scroll reduction; each watchlist tile's own
              padding also reduced (p-7 → p-5). */}
          <section className="flex flex-1 flex-col rounded-2xl border p-5 shadow-sm md:p-6"
            style={{ background: CARD, borderColor: B60 }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="posh-card-title text-xl">Watchlist</h2>
              <Link href="/watchlist" className="posh-link hidden sm:inline-block">View all →</Link>
            </div>
            <div className="mt-4 flex-1">
              {!watchlistReady ? (
                <p className="posh-muted py-8 text-center text-xs">Loading…</p>
              ) : watchlistItems.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="posh-card-title">No items in watchlist</p>
                  <Link href="/products" className="posh-link mt-3 inline-block">Browse &amp; watchlist materials →</Link>
                </div>
              ) : (
                <div className="grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2"
                  style={{ borderColor: B60, background: B60 }}>
                  {watchlistItems.map((w) => (
                    <Link key={w.id} href="/watchlist" className="block bg-[color:var(--posh-bg-card)] p-5 transition-colors hover:bg-[rgba(var(--posh-wash-rgb),0.03)]">
                      <div className="flex items-baseline justify-between">
                        <h3 className="posh-card-title">{w.name}</h3>
                        <span className="posh-label">{gapLabel(w.priceIntelligence?.gapToTargetPct ?? null)}</span>
                      </div>
                      {/* Watchlist price — scoped to this dashboard preview
                          only (not the shared .posh-page-title style, so
                          other pages using that class are unaffected):
                          Orange (var(--posh-primary)) and ~75% of the
                          previous font size (posh-page-title's text-3xl/
                          md:text-4xl → text-xl/md:text-2xl here). */}
                      <p className="mt-3 text-xl font-extrabold leading-[1.1] tracking-[-0.02em] md:text-2xl" style={{ color: "var(--posh-primary)" }}>
                        {w.priceIntelligence?.currentPricePerBaseUnit ? fmtInr(w.priceIntelligence.currentPricePerBaseUnit) : fmtInr(w.basePrice)} / {w.unit}
                      </p>
                      <p className="posh-subtitle mt-2">{w.targetPrice ? `Target: ${fmtInr(w.targetPrice)}` : "No target set"}</p>
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
