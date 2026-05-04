import { SupplierNav } from "@/components/supplier/SupplierNav";

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[280px_1fr]">
      <SupplierNav />
      <main className="space-y-4">
        <header className="panel flex items-center justify-between p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operational Console</p>
            <h2 className="text-2xl font-extrabold text-slate-900">Supplier Portal</h2>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">KYC: In Review</span>
        </header>
        {children}
      </main>
    </div>
  );
}