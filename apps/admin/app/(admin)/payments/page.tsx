import { PaymentVerificationQueue } from "@/components/admin/PaymentVerificationQueue";
import { InvoiceGenerationQueue } from "@/components/admin/InvoiceGenerationQueue";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type PendingPayment = {
  id: string;
  orderId: string;
  enquiryId?: string;
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

type VerifiedPayment = PendingPayment & {
  invoice: { id: string; invoiceNumber: string } | null;
};

export default async function PaymentsPage() {
  await requireMenu("payments");

  const [items, verified] = await Promise.all([
    adminApiGet<PendingPayment[]>("/admin/payments/pending").catch(() => []),
    adminApiGet<VerifiedPayment[]>("/admin/payments/verified").catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <PaymentVerificationQueue items={items} />
      <InvoiceGenerationQueue items={verified} />
    </div>
  );
}
