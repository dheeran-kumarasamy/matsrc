import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { SupplierHeader } from "@/components/supplier/SupplierHeader";
import { SupplierNav } from "@/components/supplier/SupplierNav";

export default async function SupplierLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      kycStatus: true,
      name: true,
      // Profile display name requirement: prefer the supplier's registered
      // company name (the identity other surfaces already use — see
      // ensureSupplierContext in lib/supplier-data.ts) over the bare
      // account-holder name, falling back to the latter when no
      // SupplierProfile exists yet (e.g. mid-onboarding).
      supplierProfile: { select: { companyName: true } },
    },
  });

  const kycStatus = (user?.kycStatus ?? "PENDING") as "PENDING" | "APPROVED" | "REJECTED";
  const displayName = user?.supplierProfile?.companyName || user?.name || session.user.email;

  return (
    <div className="min-h-screen">
      <SupplierHeader kycStatus={kycStatus} displayName={displayName} />
      <div className="mx-auto grid w-full max-w-[1260px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8">
        <SupplierNav />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}