import { BuilderNav, BuilderNavMobileTrigger } from "@/components/builder/BuilderNav";
import QuickRequestForm from "@/components/cart/QuickRequestForm";
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

      {/* FR-32: Floating Quick Request Form */}
      <QuickRequestForm floating />
      {/* Persistent cart drawer + inline stepped checkout wizard (spec 5A) */}
      <CartDrawer />
      {/* Product quick-view overlay (spec 5A) */}
      {modal}
    </div>
  );
}

