import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { SupplierHeader } from "@/components/supplier/SupplierHeader";

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
      <main className="mx-auto w-full max-w-[1260px] px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}