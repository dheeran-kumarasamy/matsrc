import Link from "next/link";
import { notFound } from "next/navigation";
import { builderApiGet, ApiError } from "@/lib/api";

type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  orderId: string;
  enquiryId: string;
  site: { name: string; addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  supplier: { companyName: string; gstin: string | null } | null;
  lineItems: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    taxRate: number | null;
    taxAmount: number;
    total: number;
  }>;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paymentStatus: string;
  amountPaid: number | null;
  amountDue: number | null;
};

// Contractor/Client invoice view. Read-only — no generation action is ever
// rendered here; the invoice must already exist (only an Admin can create
// it, see the Admin app). Data comes entirely from the stored invoice
// snapshot returned by /api/builder/orders/[id]/invoice.
export default async function BuilderInvoicePage({ params }: { params: { id: string } }) {
  let invoice: InvoiceDetail | null = null;
  try {
    invoice = await builderApiGet<InvoiceDetail>(`/orders/${params.id}/invoice`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  if (!invoice) {
    notFound();
  }

  return (
    <div className="posh-body mx-auto max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="posh-eyebrow">Invoice</p>
          <h1 className="posh-page-title mt-2">{invoice.invoiceNumber}</h1>
          <p className="posh-subtitle mt-1">
            {new Date(invoice.invoiceDate).toLocaleDateString("en-IN")} · Order #{invoice.enquiryId}
          </p>
        </div>
        <a href={`/api/builder/orders/${params.id}/invoice/pdf`} target="_blank" rel="noreferrer" className="posh-btn">
          Download PDF
        </a>
      </header>

      <section className="posh-card space-y-3 p-6">
        <h2 className="posh-card-title">Products / Services</h2>
        <div className="divide-y divide-[color:var(--posh-border)] rounded-xl border" style={{ borderColor: "var(--posh-border)" }}>
          {invoice.lineItems.map((li) => (
            <div key={li.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-bold" style={{ color: "var(--posh-fg)" }}>{li.productName}</p>
                <p className="posh-label mt-1">
                  {li.quantity} × ₹{li.unitPrice.toLocaleString("en-IN")}
                </p>
              </div>
              <p className="font-bold" style={{ color: "var(--posh-fg)" }}>₹{li.total.toLocaleString("en-IN")}</p>
            </div>
          ))}
        </div>
        <div className="text-right text-sm">
          <p className="posh-subtitle">Subtotal: ₹{invoice.subtotal.toLocaleString("en-IN")}</p>
          <p className="posh-subtitle">Tax: ₹{invoice.taxAmount.toLocaleString("en-IN")}</p>
          <p className="text-base font-bold" style={{ color: "var(--posh-fg)" }}>
            Total: ₹{invoice.totalAmount.toLocaleString("en-IN")}
          </p>
        </div>
      </section>

      <section className="posh-card space-y-2 p-6">
        <h2 className="posh-card-title">Payment</h2>
        <p className="posh-subtitle">Status: {invoice.paymentStatus}</p>
        {invoice.amountPaid !== null ? <p className="posh-subtitle">Paid: ₹{invoice.amountPaid.toLocaleString("en-IN")}</p> : null}
        {invoice.amountDue !== null ? <p className="posh-subtitle">Due: ₹{invoice.amountDue.toLocaleString("en-IN")}</p> : null}
      </section>

      <Link href={`/orders/${params.id}`} className="posh-btn-ghost inline-block">
        Back to Order
      </Link>
    </div>
  );
}
