"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import ProductFilters from "@/components/products/ProductFilters";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { builderApiGet } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";


const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Browse Materials" },
  { href: "/orders", label: "My Orders" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/cart", label: "Cart" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/reports", label: "Reports" },
  { href: "/disputes", label: "Disputes" },
];


type RecentOrder = {
  id: string;
  status: "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  totalLabel?: string;
  total: number;
  items: Array<{ name: string }>;
};

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold transition ${
              active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

function BrandBlock() {
  return (
    <div className="rounded-xl bg-[linear-gradient(120deg,#1a4f8a,#e87722)] p-4 text-white">
      <p className="text-xs uppercase tracking-[0.2em] text-blue-100">BuildMart</p>
      <h1 className="mt-1 text-xl font-extrabold">Builder Hub</h1>
    </div>
  );
}

// Fetches the 5 most recent orders (and their items) for the desktop sidebar
// "Recent Orders" panel. This replaces the nav-link list on desktop — those
// links remain reachable via the mobile nav Sheet, the Dashboard's Quick
// Actions panel, and the Dashboard's own Recent Orders table, so nothing is
// lost, just de-duplicated (see task: sidebar should surface recent orders +
// items instead of repeating menu links already available elsewhere).
function useRecentOrders() {
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    builderApiGet<RecentOrder[]>("/orders")
      .then((data) => {
        if (!cancelled) {
          setOrders(data.slice(0, 5));
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { orders, loading, error };
}

// Recent Orders panel: the 5 most recent orders + the items inside each,
// shown on the desktop sidebar in place of the nav link list (task
// requirement). Clicking an order opens the order detail overlay (via the
// @modal intercepting route) without navigating away from the current page.
function RecentOrdersPanel() {
  const { orders, loading, error } = useRecentOrders();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Recent Orders</h2>
        <Link href="/orders" className="text-xs font-semibold text-blue-700 hover:underline">
          View all →
        </Link>
      </div>

      {loading ? (
        <p className="px-1 text-xs text-slate-400">Loading orders…</p>
      ) : error ? (
        <p className="px-1 text-xs text-red-500">Could not load orders.</p>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-400">No orders yet.</p>
          <Link href="/products" className="mt-1 inline-block text-xs text-blue-700 hover:underline">
            Browse materials →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="block rounded-lg border border-slate-100 p-2.5 transition hover:border-blue-200 hover:bg-blue-50/40"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs font-semibold text-slate-700">#{order.id.slice(0, 8)}</p>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {order.items?.[0]?.name ?? "—"}
                {(order.items?.length ?? 0) > 1 ? ` +${order.items.length - 1} more` : ""}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-slate-800">
                {order.totalLabel ?? `₹${order.total?.toLocaleString("en-IN")}`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Mobile burger button + Sheet drawer, mounted in the (builder) header.
// Keeps the full nav-link list — the sidebar's Recent Orders panel is a
// desktop-only affordance since mobile still needs a compact way to reach
// every section.
export function BuilderNavMobileTrigger() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const showProductFilters = pathname === "/products";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-blue-700 hover:text-blue-700 lg:hidden"
      >
        <Menu size={20} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col p-0">
          <SheetHeader>
            <SheetTitle>Builder Hub</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <BrandBlock />
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            {showProductFilters ? (
              <div className="border-t border-slate-100 pt-4">
                <ProductFilters
                  selectedCategory={searchParams.get("category") ?? undefined}
                  selectedBrand={searchParams.get("brand") ?? undefined}
                  minPrice={searchParams.get("minPrice") ?? undefined}
                  maxPrice={searchParams.get("maxPrice") ?? undefined}
                  q={searchParams.get("q") ?? undefined}
                  sort={searchParams.get("sort") ?? undefined}
                />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// Desktop sidebar — hidden below `lg`, visible inline at `lg` and up.
// Shows the brand block + the 5 most recent orders (and their items) in
// place of the menu link list — those links are already reachable via the
// mobile nav Sheet, the Dashboard's Quick Actions panel, and Dashboard's own
// Recent Orders table.
export function BuilderNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // FR-04: Show the Browse Materials filters directly below the main panel
  // when the builder is on the product discovery page.
  const showProductFilters = pathname === "/products";

  return (
    <aside className="panel sticky top-4 hidden h-fit space-y-4 p-4 lg:block">
      <BrandBlock />
      <RecentOrdersPanel />

      {showProductFilters ? (
        <div className="border-t border-slate-100 pt-4">
          <ProductFilters
            selectedCategory={searchParams.get("category") ?? undefined}
            selectedBrand={searchParams.get("brand") ?? undefined}
            minPrice={searchParams.get("minPrice") ?? undefined}
            maxPrice={searchParams.get("maxPrice") ?? undefined}
            q={searchParams.get("q") ?? undefined}
            sort={searchParams.get("sort") ?? undefined}
          />
        </div>
      ) : null}
    </aside>
  );
}
