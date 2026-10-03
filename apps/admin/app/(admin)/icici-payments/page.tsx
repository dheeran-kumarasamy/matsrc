import { IciciPaymentsQueue, type IciciPaymentRow } from "@/components/admin/IciciPaymentsQueue";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

// ICICI Bank Payment Gateway — UAT ONLY. Admin visibility page (task §26).
export default async function IciciPaymentsPage() {
  await requireMenu("icici-payments");

  const items = await adminApiGet<IciciPaymentRow[]>("/admin/icici-payments").catch(() => []);

  return (
    <div className="space-y-6">
      <IciciPaymentsQueue items={items} />
    </div>
  );
}
