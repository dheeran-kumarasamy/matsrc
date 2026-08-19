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
    select: { kycStatus: true },
  });

  const kycStatus = (user?.kycStatus ?? "PENDING") as "PENDING" | "APPROVED" | "REJECTED";

  return (
    <div className="min-h-screen">
      <SupplierHeader kycStatus={kycStatus} />
      <div className="mx-auto grid w-full max-w-[1260px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8">
        <SupplierNav />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}