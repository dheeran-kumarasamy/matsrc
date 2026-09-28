import Link from "next/link";
import { notFound } from "next/navigation";
import { adminApiGet } from "@/lib/api";
import { requireAdminAccess } from "@/lib/rbac";

type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  orderId: string;
  enquiryId: string;
  builder: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  site: {
    id: string;
    name: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
  } | null;
  supplier: { id: string; companyName: string; gstin: string | null; email: string | null; phone: string | null } | null;
  lineItems: Array<{
    id: string;
    productName: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    taxRate: number | null;
    taxAmount: number;
    subtotal: number;
    total: number;
  }>;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  paymentStatus: string;
  amountPaid: number | null;
  amountDue: number | null;
  generatedBy: { id: string; name: string | null; email: string | null } | null;
  generatedAt: string;
};

// Admin invoice view — every Admin/Super Admin can view any invoice (no
// per-order ownership scoping needed here, unlike the builder-facing
// equivalent). Displayed data comes entirely from the stored Invoice/
// InvoiceLineItem snapshot — never recomputed from live order/product
// pricing (see InvoicesService.serialize).
export default async function AdminInvoiceViewPage({ params }: { params: { orderId: string } }) {
  await requireAdminAccess();

  let invoice: InvoiceDetail | null = null;
  try {
    invoice = await adminApiGet<InvoiceDetail>(`/admin/orders/${params.orderId}/invoice`);
  } catch {
    notFound();
  }

  if (!invoice) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Invoice</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">{invoice.invoiceNumber}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {new Date(invoice.invoiceDate).toLocaleDateString("en-IN")} · Order/Enquiry #{invoice.enquiryId}
          </p>
        </div>
        <a
          href={`/api/admin/orders/${params.orderId}/invoice/pdf`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
        >
          Download PDF
        </a>
      </header>

      <section className="panel grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Contractor/Client</p>
          <p className="mt-1 font-semibold text-slate-900">{invoice.builder?.name ?? "—"}</p>
          <p className="text-sm text-slate-600">{invoice.builder?.email}</p>
          <p className="text-sm text-slate-600">{invoice.builder?.phone}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Site</p>
          <p className="mt-1 font-semibold text-slate-900">{invoice.site?.name ?? "Unassigned"}</p>
          <p className="text-sm text-slate-600">
            {[invoice.site?.addressLine, invoice.site?.city, invoice.site?.state, invoice.site?.pincode].filter(Boolean).join(", ")}
          </p>
          {invoice.site?.gstin ? <p className="text-sm text-slate-600">GSTIN: {invoice.site.gstin}</p> : null}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Supplier</p>
          <p className="mt-1 font-semibold text-slate-900">{invoice.supplier?.companyName ?? "—"}</p>
          {invoice.supplier?.gstin ? <p className="text-sm text-slate-600">GSTIN: {invoice.supplier.gstin}</p> : null}
          <p className="text-sm text-slate-600">{[invoice.supplier?.email, invoice.supplier?.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment</p>
          <p className="mt-1 font-semibold text-slate-900">{invoice.paymentStatus}</p>
          {invoice.amountPaid !== null ? <p className="text-sm text-slate-600">Paid: ₹{invoice.amountPaid.toLocaleString("en-IN")}</p> : null}
          {invoice.amountDue !== null ? <p className="text-sm text-slate-600">Due: ₹{invoice.amountDue.toLocaleString("en-IN")}</p> : null}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-bold text-slate-950">Products / Services</h2>
        <div className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {invoice.lineItems.map((li) => (
            <div key={li.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-bold text-slate-900">{li.productName}</p>
                <p className="text-xs text-slate-500">
                  {li.quantity} × ₹{li.unitPrice.toLocaleString("en-IN")}
                  {li.taxRate ? ` · Tax ${li.taxRate}% (₹${li.taxAmount.toLocaleString("en-IN")})` : ""}
                </p>
              </div>
              <p className="font-bold text-slate-900">₹{li.total.toLocaleString("en-IN")}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1 text-right text-sm">
          <p className="text-slate-600">Subtotal: ₹{invoice.subtotal.toLocaleString("en-IN")}</p>
          <p className="text-slate-600">Tax: ₹{invoice.taxAmount.toLocaleString("en-IN")}</p>
          <p className="text-base font-bold text-slate-950">Total: ₹{invoice.totalAmount.toLocaleString("en-IN")}</p>
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Generated by {invoice.generatedBy?.name ?? invoice.generatedBy?.email ?? "Admin"} on{" "}
        {new Date(invoice.generatedAt).toLocaleString("en-IN")}
      </p>

      <Link href="/payments" className="inline-block text-sm font-semibold text-slate-700 underline">
        Back to Payments
      </Link>
    </div>
  );
}
