"use client";

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

const STATUS_BADGE: Record<SupplierInvoiceSummary["status"], string> = {
  PENDING_REVIEW: "bg-amber-50 text-amber-700",
  REJECTED: "bg-rose-50 text-rose-700",
  CONFIRMED: "bg-emerald-50 text-emerald-700",
};

// Supplier Invoice Upload / Admin Verification queue — lists every order's
// current supplier-uploaded invoice awaiting (or already past) Admin
// review. Clicking through to the detail page is where the actual
// quantity/value review + reject/confirm actions happen (see
// SupplierInvoiceReview.tsx) — this list is read-only.
export function SupplierInvoiceQueue({ items }: { items: SupplierInvoiceSummary[] }) {
  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Supplier Invoices</h3>
      <p className="mt-1 text-sm text-slate-600">
        Invoices uploaded by suppliers, awaiting Admin review of the actual invoiced quantities/values before a
        BuildOhub buyer invoice can be generated.
      </p>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No supplier invoices match this filter.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item) => (
            <a
              key={item.id}
              href={`/supplier-invoices/${item.id}`}
              className="block rounded-xl border border-slate-200 p-4 hover:border-slate-400"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Order #{item.orderNumber ?? item.enquiryId}</p>
                  <p className="text-sm text-slate-600">{item.supplier?.companyName ?? "Unknown supplier"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.fileName}
                    {item.supplierInvoiceNumber ? ` · Ref ${item.supplierInvoiceNumber}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_BADGE[item.status]}`}>
                    {item.status.replace("_", " ")}
                  </span>
                  {item.hasDiscrepancy ? (
                    <span className="rounded-full bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700">
                      Rate Discrepancy
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                Uploaded {new Date(item.uploadedAt).toLocaleString("en-IN")}
                {item.confirmedTotalAmount !== null ? ` · Confirmed total ₹${item.confirmedTotalAmount.toLocaleString("en-IN")}` : ""}
              </p>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
