import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { SupplierNav } from "@/components/supplier/SupplierNav";

const kycBadge: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "KYC: Pending", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "KYC: Approved", cls: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "KYC: Rejected", cls: "bg-red-50 text-red-700" },
};

export default async function SupplierLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { kycStatus: true },
  });

  const badge = kycBadge[user?.kycStatus ?? "PENDING"];

  return (
    <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[280px_1fr]">
      <SupplierNav />
      <main className="space-y-4">
        <header className="panel flex items-center justify-between p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operational Console</p>
            <h2 className="text-2xl font-extrabold text-slate-900">Supplier Portal</h2>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge.cls}`}>{badge.label}</span>
        </header>
        {children}
      </main>
    </div>
  );
}