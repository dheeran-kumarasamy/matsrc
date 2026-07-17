import Link from "next/link";
import { Search, Bell, Flag } from "lucide-react";
import { BuilderNav, BuilderNavMobileTrigger } from "@/components/builder/BuilderNav";
import CartLauncher from "@/components/cart/CartLauncher";
import CartDrawer from "@/components/cart/CartDrawer";
import HeaderIconLink from "@/components/builder/HeaderIconLink";



// `modal` is the @modal parallel route slot (see app/(builder)/@modal/).
// It renders the intercepted product quick-view overlay on top of this
// layout's children WITHOUT unmounting them — the core of the spec 5A
// single-page overlay ordering architecture.
export default function BuilderLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal?: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 overflow-x-hidden p-4 lg:grid-cols-[280px_1fr]">
      <BuilderNav />
      <main className="space-y-4">
        {/* REQ-03/04/05: "Builder Portal" title removed. This header row is
            now the persistent search-bar row — the search input flex-grows,
            and Cart → Bell (notifications) → Report sit at the far right,
            in that order, on every builder page. No global search API is
            wired here yet, so the input just deep-links into the existing
            products-page search form via its `q` query param on submit. */}
        <header className="panel flex items-center gap-3 p-4">
          <BuilderNavMobileTrigger />
          <form action="/products" method="GET" className="flex-1">
            <input
              type="search"
              name="q"
              placeholder="Search TMT bars, cement, bricks..."
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </form>
          <div className="flex items-center gap-2 sm:gap-3">
            <CartLauncher />
            <HeaderIconLink href="/notifications" label="Alerts" icon={Bell} ariaLabel="Notifications" />
            {/* "Report" entry point: no existing Report page was found in
                the builder app, so this reuses the existing Disputes flow
                (the closest existing "raise an issue" destination) — flagged
                as an assumption; swap the href/icon if a dedicated Report
                feature is introduced later. */}
            <HeaderIconLink href="/disputes" label="Report" icon={Flag} ariaLabel="Report an issue" />
          </div>
        </header>
        {children}
      </main>


      {/* Floating Browse Materials shortcut — always available access to the
          products listing page from anywhere in the builder portal. */}
      <Link
        href="/products"
        className="fixed bottom-6 right-6 z-40 flex min-h-[44px] items-center gap-2 rounded-full bg-accent-500 px-5 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-accent-600"
      >
        <Search size={18} />
        <span className="hidden sm:inline">Browse Materials</span>
      </Link>
      {/* Persistent cart drawer + inline stepped checkout wizard (spec 5A) */}

      <CartDrawer />
      {/* Product quick-view overlay (spec 5A) */}
      {modal}
    </div>
  );
}

