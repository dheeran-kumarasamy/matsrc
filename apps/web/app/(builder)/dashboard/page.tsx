import Link from "next/link";
import { builderApiGet } from "@/lib/api";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";

// ── Types ─────────────────────────────────────────────────────────────────────
type Order = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  totalLabel?: string;
  total: number;
  itemCount?: number;
  items?: Array<{ name: string }>;
  supplierName?: string;
};

// ── AI Suggestions (static — matches posh-web-flair exactly) ─────────────────
const SUGGESTIONS = [
  { item: "Binding Wire 18G",    why: "Reordered every 3 weeks · due now",  move: "₹72,000/T",  delta: "+2.1%" },
  { item: "Shuttering Ply 18mm", why: "Pairs with your slab schedule",       move: "₹92/sqft",   delta: "+1.3%" },
  { item: "Fly Ash Bricks",      why: "12% under your last landed rate",     move: "₹6.4/nos",   delta: "-1.8%" },
  { item: "TMT Fe-550D · 16mm",  why: "Grade upgrade, same lead time",       move: "₹64,100/T",  delta: "+0.6%" },
  { item: "Curing Compound",     why: "Watchlist supplier cut price",         move: "₹210/L",     delta: "-3.4%" },
];

// ── Quick-launch tiles ────────────────────────────────────────────────────────
const QUICK_LINKS = [
  { href: "/products",  label: "Browse Materials",  sub: "Live prices · verified suppliers" },
  { href: "/watchlist", label: "Watchlist & Alerts", sub: "Price targets · WhatsApp alerts" },
  { href: "/reports",   label: "Reports",            sub: "Spend · delivery · savings" },
  { href: "/disputes",  label: "Disputes",           sub: "Raise or track a dispute" },
];

// ── Unified dashboard — posh-web-flair brown aesthetic + real API data ────────
export default async function DashboardPage() {
  // Live data fetch — zeros on error so the page always renders
  let orders: Order[] = [];
  let cartCount = 0;
  let watchlistCount = 0;

  try {
    const [ordersData, cart, watchlist] = await Promise.all([
      builderApiGet<Order[]>("/orders"),
      builderApiGet<{ items: Array<{ id: string }> }>("/cart"),
      builderApiGet<Array<{ id: string }>>("/watchlist"),
    ]);
    orders        = ordersData;
    cartCount     = cart.items.length;
    watchlistCount = watchlist.length;
  } catch {
    // show zeros on error
  }

  const recentOrders = orders.slice(0, 5);

  const KPIS = [
    { label: "Active Orders", value: String(orders.length),    hint: "Orders in progress",     href: "/orders" },
    { label: "Cart Items",    value: String(cartCount),        hint: "Items ready to checkout", href: "/cart" },
    { label: "Price Alerts",  value: String(watchlistCount),   hint: "Watchlist materials",     href: "/watchlist" },
  ];

  return (
    <main
      className="relative overflow-hidden rounded-2xl"
      style={{ background: "var(--posh-bg)" }}
    >
      {/* Warm radial gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--posh-gradient-warm)" }}
      />

      <div className="relative space-y-6 px-6 py-6 md:px-10 md:py-8">

        {/* ── Welcome header ── */}
        <div>
          <p
            className="mb-1 text-[10px] font-semibold uppercase tracking-[0.3em]"
            style={{ color: "var(--posh-primary)" }}
          >
            Procurement Desk
          </p>
          <h1
            className="posh-heading text-[clamp(1.75rem,4vw,2.75rem)] leading-none"
            style={{ color: "var(--posh-fg)" }}
          >
            Builder Dashboard
          </h1>
        </div>

        {/* ── Live KPI strip ── */}
        <section className="grid gap-4 sm:grid-cols-3">
          {KPIS.map((k) => (
            <Link key={k.label} href={k.href} className="block">
              <article
                className="rounded-2xl border p-6 transition-opacity hover:opacity-80"
                style={{ background: "rgba(36,31,22,0.55)", borderColor: "var(--posh-border)" }}
              >
                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.25em]"
                  style={{ color: "var(--posh-fg-muted)" }}
                >
                  {k.label}
                </p>
                <p
                  className="posh-heading mt-4 text-5xl"
                  style={{ color: "var(--posh-primary)" }}
                >
                  {k.value}
                </p>
                <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>
                  {k.hint}
                </p>
              </article>
            </Link>
          ))}
        </section>

        {/* ── Two-column body: AI Suggestions + Live Recent Orders ── */}
        <section className="grid gap-6 lg:grid-cols-[340px_1fr]">

          {/* LEFT — AI Suggestions (static, posh-web-flair) */}
          <div className="rounded-3xl border p-7"
            style={{ background: "rgba(36,31,22,0.45)", borderColor: "var(--posh-border)" }}>
            <div className="mb-6 flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full" style={{ background: "var(--posh-primary)" }} />
              <p className="text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: "var(--posh-fg-muted)" }}>
                AI Suggestions
              </p>
            </div>
            <div className="space-y-5">
              {SUGGESTIONS.map((s) => (
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
            <Link href="/sourcing" className="mt-6 inline-block text-sm transition-opacity hover:opacity-70"
              style={{ color: "var(--posh-primary)" }}>Open AI Sourcing →</Link>
          </div>

          {/* RIGHT — Live Recent Orders */}
          <div className="overflow-hidden rounded-3xl border"
            style={{ background: "rgba(36,31,22,0.45)", borderColor: "var(--posh-border)" }}>
            <div className="flex items-center justify-between border-b px-7 py-5"
              style={{ borderColor: "var(--posh-border)" }}>
              <h2 className="posh-heading text-xl" style={{ color: "var(--posh-fg)" }}>Recent Orders</h2>
              <Link href="/orders" className="text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: "var(--posh-primary)" }}>View all →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--posh-fg-muted)" }}>
                  <tr>
                    {["Order", "Material", "Supplier", "Total", "Status"].map((h) => (
                      <th key={h} className="border-b px-7 py-3 font-normal" style={{ borderColor: "var(--posh-border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-7 py-14 text-center text-sm" style={{ color: "var(--posh-fg-muted)" }}>
                        No orders yet.{" "}
                        <Link href="/products" className="underline underline-offset-2 transition-opacity hover:opacity-70"
                          style={{ color: "var(--posh-primary)" }}>Browse materials →</Link>
                      </td>
                    </tr>
                  ) : recentOrders.map((o) => (
                    <tr key={o.id} className="border-b transition-colors hover:bg-white/5"
                      style={{ borderColor: "var(--posh-border)" }}>
                      <td className="px-7 py-4">
                        <Link href={`/orders/${o.id}`}
                          className="font-mono text-xs transition-opacity hover:opacity-70"
                          style={{ color: "var(--posh-primary)" }}>#{o.id.slice(0, 8)}</Link>
                      </td>
                      <td className="px-7 py-4" style={{ color: "var(--posh-fg)" }}>
                        {o.items?.[0]?.name ?? "—"}
                        {(o.itemCount ?? o.items?.length ?? 0) > 1 ? ` +${(o.itemCount ?? o.items!.length) - 1}` : ""}
                      </td>
                      <td className="px-7 py-4" style={{ color: "var(--posh-fg-muted)" }}>{o.supplierName ?? "—"}</td>
                      <td className="posh-heading px-7 py-4 text-lg" style={{ color: "var(--posh-primary)" }}>
                        {o.totalLabel ?? `₹${o.total?.toLocaleString("en-IN")}`}
                      </td>
                      <td className="px-7 py-4"><OrderStatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Quick-launch tiles ── */}
        <section className="grid gap-px overflow-hidden rounded-3xl border sm:grid-cols-2 xl:grid-cols-4"
          style={{ borderColor: "var(--posh-border)", background: "var(--posh-border)" }}>
          {QUICK_LINKS.map((ql) => (
            <Link key={ql.href} href={ql.href}
              className="group block p-7 transition-colors hover:bg-white/5"
              style={{ background: "var(--posh-bg)" }}>
              <h3 className="text-xl" style={{ color: "var(--posh-fg)" }}>{ql.label}</h3>
              <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{ql.sub}</p>
              <span className="mt-5 inline-block text-sm transition-transform duration-500 group-hover:translate-x-1"
                style={{ color: "var(--posh-primary)" }}>Go →</span>
            </Link>
          ))}
        </section>

        {/* bottom padding */}
        <div className="pb-2" />

      </div>
    </main>
  );
}
