import Link from "next/link";
import { AdvancePaymentQueue } from "@/components/admin/AdvancePaymentQueue";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type AdvancePaymentItem = {
  id: string;
  referenceNumber: string;
  buyer: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  amount: number;
  paymentMethod: string;
  paymentReference: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  rejectionReason: string | null;
  screenshotFileName: string | null;
  screenshotUrl: string;
};

const FILTERS = ["All", "Pending", "Approved", "Rejected"] as const;

export default async function AdvancePaymentsPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  await requireMenu("advance-payments");

  const filter = (searchParams.filter || "All") as (typeof FILTERS)[number];
  const statusQuery = filter === "All" ? "" : `?status=${filter.toUpperCase()}`;

  const items = await adminApiGet<AdvancePaymentItem[]>(`/admin/advance-payments${statusQuery}`).catch(() => []);

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap gap-2 p-3">
        {FILTERS.map((option) => (
          <Link
            key={option}
            href={option === "All" ? "/advance-payments" : `/advance-payments?filter=${option}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              filter === option ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {option}
          </Link>
        ))}
      </div>
      <AdvancePaymentQueue items={items} />
    </div>
  );
}
