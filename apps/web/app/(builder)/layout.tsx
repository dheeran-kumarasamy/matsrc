import { BuilderNav } from "@/components/builder/BuilderNav";
import QuickRequestForm from "@/components/cart/QuickRequestForm";

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[280px_1fr]">
      <BuilderNav />
      <main className="space-y-4">
        <header className="panel flex items-center justify-between p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Procurement Workspace</p>
            <h2 className="text-2xl font-extrabold text-slate-900">Builder Portal</h2>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">KYC: Verified</span>
        </header>
        {children}
      </main>
      {/* FR-32: Floating Quick Request Form */}
      <QuickRequestForm floating />
    </div>
  );
}
