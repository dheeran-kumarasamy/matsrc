import { ProfileForm } from "@/components/supplier/ProfileForm";
import { KycStatusPanel } from "@/components/supplier/KycStatusPanel";
import { getSupplierProfileData } from "@/lib/supplier-data";

export default async function SupplierProfilePage() {
  const { profile, kycItems } = await getSupplierProfileData();

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <ProfileForm initial={profile} />

      <KycStatusPanel items={kycItems} />
    </div>
  );
}