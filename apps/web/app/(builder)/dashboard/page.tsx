import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { builderApiGet } from "@/lib/api";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";

type Order = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  totalLabel: string;
  total: number;
  items: Array<{ name: string }>;
};

type Kpi    = { label: string; value: string; hint: string; href: string };
type Action = { href: string; label: string };

// ── Posh shell: deep warm dark container with radial gradient overlay ─────────
function PoshShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-3xl" style={{ background: "var(--posh-bg)" }}>
      <div className="pointer-events-none absolute inset-0 rounded-3xl" style={{ background: "var(--posh-gradient-warm)" }} />
      <div className="relative space-y-8 p-6 md:p-8">{children}</div>
    </div>
  );
}

// ── Page header: editorial label + serif title + AI Sourcing CTA ──────────────
function DashHeader() {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em]" style={{ color: "var(--posh-primary)" }}>
          Procurement Desk
        </p>
        <h1 className="posh-heading text-[clamp(2rem,5vw,3.25rem)] leading-none" style={{ color: "var(--posh-fg)" }}>
          Builder Dashboard
        </h1>
      </div>
      <Link
        href="/sourcing"
        className="hidden shrink-0 items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-70 sm:flex"
        style={{ borderColor: "var(--posh-border)", color: "var(--posh-primary)", background: "rgba(196,145,90,0.08)" }}
      >
        AI Sourcing <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}

// ── KPI grid: 3 dark cards with serif large number ───────────────────────────
function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-3">
      {kpis.map((kpi) => (
        <Link key={kpi.label} href={kpi.href} className="block">
          <article
            className="rounded-2xl border p-6 transition-opacity hover:opacity-80"
            style={{ background: "var(--posh-bg-card)", borderColor: "var(--posh-border)" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em]" style={{ color: "var(--posh-fg-muted)" }}>
              {kpi.label}
            </p>
            <p className="posh-heading mt-4 text-5xl" style={{ color: "var(--posh-primary)" }}>
              {kpi.value}
            </p>
            <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{kpi.hint}</p>
          </article>
        </Link>
      ))}
    </section>
  );
}

// UF-02 entry: builder dashboard summary — posh-web-flair editorial dark theme
export default async function DashboardPage() {
  let cartCount = 0;
  let orders: Order[] = [];
  let watchlistCount = 0;

  try {
    const [cart, ordersData, watchlist] = await Promise.all([
      builderApiGet<{ items: Array<{ id: string }> }>("/cart"),
      builderApiGet<Order[]>("/orders"),
      builderApiGet<Array<{ id: string }>>("/watchlist"),
    ]);

    cartCount = cart.items.length;
    orders = ordersData;
    watchlistCount = watchlist.length;
  } catch {
    // show zeros on error
  }

  const recentOrders = orders.slice(0, 5);

  const kpis: Kpi[] = [
    { label: "Active Orders", value: String(orders.length),   hint: "Orders in progress",     href: "/orders" },
    { label: "Cart Items",    value: String(cartCount),       hint: "Items ready to checkout", href: "/cart" },
    { label: "Price Alerts",  value: String(watchlistCount),  hint: "Watchlist materials",     href: "/watchlist" },
  ];

  const secondaryActions: Action[] = [
    { href: "/cart",     label: "View Cart" },
    { href: "/reports",  label: "View Reports" },
    { href: "/disputes", label: "Raise Dispute" },
  ];

  return (
    <PoshShell>
      <DashHeader />
      <KpiGrid kpis={kpis} />

      {/* ── Bottom grid: Recent Orders + Quick Actions ── */}
      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">

        {/* Recent orders panel */}
        <div className="overflow-hidden rounded-2xl border"
          style={{ background: "var(--posh-bg-card)", borderColor: "var(--posh-border)" }}>
          <div className="flex items-center justify-between border-b px-6 py-4"
            style={{ borderColor: "var(--posh-border)" }}>
            <h2 className="posh-heading text-xl" style={{ color: "var(--posh-fg)" }}>Recent Orders</h2>
            <Link href="/orders" className="text-xs font-medium transition-opacity hover:opacity-70"
              style={{ color: "var(--posh-primary)" }}>
              View all →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  {["Order", "Material", "Total", "Status"].map((h) => (
                    <th key={h}
                      className="border-b px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.2em]"
                      style={{ color: "var(--posh-fg-muted)", borderColor: "var(--posh-border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-sm"
                      style={{ color: "var(--posh-fg-muted)" }}>
                      No orders yet.{" "}
                      <Link href="/products"
                        className="underline underline-offset-2 transition-opacity hover:opacity-70"
                        style={{ color: "var(--posh-primary)" }}>
                        Browse materials →
                      </Link>
                    </td>
                  </tr>
                ) : (
                  recentOrders.map((order) => (
                    <tr key={order.id} className="border-b transition-colors hover:bg-white/5"
                      style={{ borderColor: "var(--posh-border)" }}>
                      <td className="px-6 py-4">
                        <Link href={`/orders/${order.id}`}
                          className="font-mono text-xs transition-opacity hover:opacity-70"
                          style={{ color: "var(--posh-primary)" }}>
                          #{order.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-6 py-4" style={{ color: "var(--posh-fg)" }}>
                        {order.items?.[0]?.name ?? "—"}
                        {(order.items?.length ?? 0) > 1 ? ` +${order.items.length - 1}` : ""}
                      </td>
                      <td className="px-6 py-4 font-medium" style={{ color: "var(--posh-fg)" }}>
                        {order.totalLabel ?? `₹${order.total?.toLocaleString("en-IN")}`}
                      </td>
                      <td className="px-6 py-4"><OrderStatusBadge status={order.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Actions panel */}
        <div className="rounded-2xl border p-6"
          style={{ background: "var(--posh-bg-card)", borderColor: "var(--posh-border)" }}>
          <h2 className="posh-heading mb-5 text-xl" style={{ color: "var(--posh-fg)" }}>Quick Actions</h2>
          <div className="space-y-3">
            <Link href="/products"
              className="block rounded-2xl px-5 py-3 text-center text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }}>
              Browse Materials
            </Link>
            {secondaryActions.map(({ href, label }) => (
              <Link key={href} href={href}
                className="block rounded-2xl border px-5 py-3 text-center text-sm font-medium transition-colors hover:bg-white/5"
                style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg-muted)" }}>
                {label}
              </Link>
            ))}
          </div>

          {/* AI Sourcing — mobile only (sm+ sees it in the page header) */}
          <div className="mt-6 border-t pt-5 sm:hidden" style={{ borderColor: "var(--posh-border)" }}>
            <Link href="/sourcing"
              className="flex items-center justify-center gap-2 rounded-2xl border px-5 py-3 text-sm font-medium transition-opacity hover:opacity-70"
              style={{ borderColor: "var(--posh-border)", color: "var(--posh-primary)", background: "rgba(196,145,90,0.08)" }}>
              AI Sourcing <ArrowUpRight size={13} />
            </Link>
          </div>

          <p className="mt-6 border-t pt-4 text-[11px] leading-relaxed"
            style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg-muted)" }}>
            All prices reflect live supplier quotes. Last refreshed on page load.
          </p>
        </div>

      </section>
    </PoshShell>
  );
}
