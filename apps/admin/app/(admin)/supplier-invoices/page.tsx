import Link from "next/link";
import { SupplierInvoiceQueue } from "@/components/admin/SupplierInvoiceQueue";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type SupplierInvoiceSummary = {
  id: string;
  orderId: string;
  enquiryId: string;
  orderNumber: string | null;
  supplier: { id: string; companyName: string } | null;
  status: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";
  fileName: string;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: string | null;
  uploadedAt: string;
  hasDiscrepancy: boolean;
  confirmedTotalAmount: number | null;
  fileUrl: string;
};

const FILTERS = ["All", "Pending Review", "Rejected", "Confirmed"] as const;

const FILTER_TO_STATUS: Record<(typeof FILTERS)[number], string | null> = {
  All: null,
  "Pending Review": "PENDING_REVIEW",
  Rejected: "REJECTED",
  Confirmed: "CONFIRMED",
};

export default async function SupplierInvoicesPage({ searchParams }: { searchParams: { filter?: string } }) {
  await requireMenu("supplier-invoices");

  const filter = (searchParams.filter as (typeof FILTERS)[number]) || "All";
  const status = FILTER_TO_STATUS[filter] ?? null;
  const query = status ? `?status=${status}` : "";

  const items = await adminApiGet<SupplierInvoiceSummary[]>(`/admin/supplier-invoices${query}`).catch(() => []);

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap gap-2 p-3">
        {FILTERS.map((option) => (
          <Link
            key={option}
            href={option === "All" ? "/supplier-invoices" : `/supplier-invoices?filter=${encodeURIComponent(option)}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              filter === option ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {option}
          </Link>
        ))}
      </div>
      <SupplierInvoiceQueue items={items} />
    </div>
  );
}
