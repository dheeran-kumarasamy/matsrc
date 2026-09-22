import { PaymentVerificationQueue } from "@/components/admin/PaymentVerificationQueue";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type PendingPayment = {
  id: string;
  orderId: string;
  orderStatus: string;
  orderTotal: number;
  paymentAmount: number;
  paymentMethod: string;
  customer: { id: string; name: string | null; email: string | null; phone: string | null };
  status: "PENDING" | "APPROVED" | "REJECTED";
  screenshotFileName: string;
  submittedAt: string;
  screenshotUrl: string;
};

export default async function PaymentsPage() {
  await requireMenu("payments");

  const items = await adminApiGet<PendingPayment[]>("/admin/payments/pending").catch(() => []);

  return <PaymentVerificationQueue items={items} />;
}
