import Link from "next/link";
import { Search } from "lucide-react";
import { BuilderNav, BuilderNavMobileTrigger } from "@/components/builder/BuilderNav";
import CartLauncher from "@/components/cart/CartLauncher";
import CartDrawer from "@/components/cart/CartDrawer";



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
        <header className="panel flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <BuilderNavMobileTrigger />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Procurement Workspace</p>
              <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">Builder Portal</h2>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <CartLauncher />
            <span className="hidden rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 sm:inline-block">
              KYC: Verified
            </span>
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

