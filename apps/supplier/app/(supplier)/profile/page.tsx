export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ProfileForm } from "@/components/supplier/ProfileForm";
import { KycStatusPanel } from "@/components/supplier/KycStatusPanel";
import { getSupplierProfileData } from "@/lib/supplier-data";

export default async function SupplierProfilePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const { profile, kycItems } = await getSupplierProfileData(session.user.email);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <ProfileForm initial={profile} />

      <KycStatusPanel items={kycItems} />
    </div>
  );
}