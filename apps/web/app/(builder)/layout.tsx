import { BuilderNav, BuilderNavMobileTrigger } from "@/components/builder/BuilderNav";
import CartDrawer from "@/components/cart/CartDrawer";
import AppHeader from "@/components/shared/AppHeader";
import FloatingBrowseLink from "@/components/builder/FloatingBrowseLink";
import { WatchlistProvider } from "@/lib/watchlist-store";






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
    <WatchlistProvider>
    <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 overflow-x-hidden p-4 lg:grid-cols-[280px_1fr]">
      <BuilderNav />
      <main className="space-y-4">
        {/* REQ-03/04/05: "Builder Portal" title removed. This header row is
            now the persistent search-bar row, standardized on the shared
            AppHeader used app-wide (search -> Cart -> Alerts -> Reports ->
            Profile, in that order) — see components/shared/AppHeader.tsx,
            the single source of truth also used by /newdashboard. */}
        <AppHeader
          className="panel sticky top-4 z-30 flex items-center gap-3 px-4 py-3"
          leftAccessory={<BuilderNavMobileTrigger />}
        />
        {children}
      </main>


      {/* BUG-03 fix: extracted into FloatingBrowseLink.tsx, which hides
          itself on the exact /products (Browse Materials) route so it no
          longer overlaps with the page it links to. */}
      <FloatingBrowseLink />

      {/* Persistent cart drawer + inline stepped checkout wizard (spec 5A) */}

      <CartDrawer />
      {/* Product quick-view overlay (spec 5A) */}
      {modal}
    </div>
    </WatchlistProvider>
  );
}

