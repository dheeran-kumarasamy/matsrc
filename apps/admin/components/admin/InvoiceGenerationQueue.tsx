"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type VerifiedPayment = {
  id: string;
  orderId: string;
  enquiryId?: string;
  orderStatus: string;
  orderTotal: number;
  paymentAmount: number;
  paymentMethod: string;
  customer: { id: string; name: string | null; email: string | null; phone: string | null };
  status: "PENDING" | "APPROVED" | "REJECTED";
  invoice: { id: string; invoiceNumber: string } | null;
};

// Admin-only "Generate Invoice" action, gated by the Admin payments page
// itself only listing orders whose payment has already been APPROVED (see
// PaymentsService.findApprovedWithInvoiceStatus) — never shown for a
// merely-uploaded/pending payment screenshot. The button is disabled while
// a request is in flight to prevent accidental double-clicks/duplicate
// invoices; the server-side InvoicesService.generate is itself idempotent
// as a backstop.
export function InvoiceGenerationQueue({ items }: { items: VerifiedPayment[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateInvoice(orderId: string) {
    setError(null);
    setLoadingId(orderId);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/invoice`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || "Failed to generate invoice");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate invoice");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Ready for Invoice</h3>
      <p className="mt-1 text-sm text-slate-600">
        Orders whose payment has been verified. Only an Admin can generate the invoice.
      </p>

      {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No verified payments are awaiting invoice generation.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Order #{item.enquiryId ?? item.orderId}</p>
                  <p className="text-sm text-slate-600">
                    {item.customer.name || item.customer.email || "Unknown customer"}
                    {item.customer.phone ? ` · ${item.customer.phone}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Order total ₹{item.orderTotal.toLocaleString("en-IN")} · Payment amount ₹
                    {item.paymentAmount.toLocaleString("en-IN")} · {item.paymentMethod}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                  Payment Verified
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {item.invoice ? (
                  <>
                    <span className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                      {item.invoice.invoiceNumber}
                    </span>
                    <a
                      href={`/orders/${item.orderId}/invoice`}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      View Invoice
                    </a>
                    <a
                      href={`/api/admin/orders/${item.orderId}/invoice/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      Download Invoice
                    </a>
                  </>
                ) : (
                  <button
                    disabled={loadingId === item.orderId}
                    onClick={() => void generateInvoice(item.orderId)}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {loadingId === item.orderId ? "Generating…" : "Generate Invoice"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
