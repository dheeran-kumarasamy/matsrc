import { BuyerCreditTermsManager, type BuyerRow } from "@/components/admin/BuyerCreditTermsManager";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

export default async function BuyersPage() {
  await requireMenu("buyers");

  const buyers = await adminApiGet<BuyerRow[]>("/admin/buyers").catch(() => []);

  return <BuyerCreditTermsManager buyers={buyers} />;
}

