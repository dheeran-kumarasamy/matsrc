export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getKycOnboardingData } from "@/lib/supplier-data";
import { OnboardingForm } from "@/components/supplier/OnboardingForm";

export default async function SupplierOnboardingPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const { kycStatus, docs } = await getKycOnboardingData(session.user.email);

  return <OnboardingForm docs={docs} kycStatus={kycStatus} />;
}
