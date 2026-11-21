import Link from "next/link";
import { notFound } from "next/navigation";
import { builderApiGet, ApiError } from "@/lib/api";

type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  documentType?: string;
  supplyType?: string;
  reverseCharge?: boolean;
  placeOfSupplyStateCode?: string | null;
  placeOfSupplyStateName?: string | null;
  sellerStateCode?: string;
  orderId: string;
  enquiryId: string;
  buyer?: {
    legalName: string | null;
    tradeName: string | null;
    gstin: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    stateCode: string | null;
  } | null;
  site: { name: string; addressLine: string | null; city: string | null; state: string | null; pincode: string | null; gstin?: string | null } | null;
  shipFrom?: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  shipTo?: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  lineItems: Array<{
    id: string;
    slNo?: number;
    productName: string;
    description?: string | null;
    hsnCode?: string | null;
    uqc?: string | null;
    unit?: string | null;
    quantity: number;
    unitPrice: number;
    taxableAmount?: number;
    taxRate: number | null;
    cgstRate?: number | null;
    cgstAmount?: number;
    sgstRate?: number | null;
    sgstAmount?: number;
    igstRate?: number | null;
    igstAmount?: number;
    taxAmount: number;
    subtotal: number;
    total: number;
  }>;
  subtotal: number;
  freightChargeAmount: number;
  otherChargesAmount: number;
  discountAmount: number;
  roundingAdjustment: number;
  taxableValue: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  taxAmount: number;
  totalAmount: number;
  totalInWords?: string;
  paymentStatus: string;
  amountPaid: number | null;
  amountDue: number | null;
  paymentDueBy?: string;
  bankDetails?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    accountType?: string;
    ifscCode: string;
    branch: string;
    bankAddress?: string;
  };
};

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

  const isIntraState =
    (invoice.sellerStateCode ?? "33") === (invoice.placeOfSupplyStateCode ?? invoice.sellerStateCode ?? "33");

  return (
    <div className="posh-body mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="posh-eyebrow">Tax Invoice</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {invoice.supplyType ?? "B2B"}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Rev. Charge: {invoice.reverseCharge ? "Yes" : "No"}
            </span>
          </div>
          <h1 className="posh-page-title mt-2">{invoice.invoiceNumber}</h1>
          <p className="posh-subtitle mt-1">
            {new Date(invoice.invoiceDate).toLocaleDateString("en-IN")} · Order #{invoice.enquiryId} · Place of Supply:{" "}
            {invoice.placeOfSupplyStateCode ?? "33"} ({invoice.placeOfSupplyStateName ?? "Tamil Nadu"})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/builder/orders/${params.id}/invoice/pdf`}
            target="_blank"
            rel="noreferrer"
            className="posh-btn"
          >
            Download Invoice PDF
          </a>
          <a
            href={`/api/builder/orders/${params.id}/site-receipt-sheet/pdf`}
            target="_blank"
            rel="noreferrer"
            className="posh-btn-ghost flex items-center gap-1.5"
            title="Download Site Material Receipt & Verification Sheet (Price-free)"
          >
            Download Site Receipt Sheet
          </a>
        </div>
      </header>
      <div className="-mt-3 text-right">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Site Material Receipt &amp; Verification Sheet: Material details and quantities only — no pricing information.
        </span>
      </div>

      {/* Parties Grid (Bill To & Ship To) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="posh-card space-y-2 p-5 text-sm">
          <h2 className="posh-card-title text-xs font-bold uppercase tracking-wider text-slate-500">Bill To (Recipient)</h2>
          <p className="font-bold text-slate-900 dark:text-slate-100">
            {invoice.buyer?.legalName ?? "Contractor / Client"}
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            {[invoice.buyer?.addressLine ?? invoice.site?.addressLine, invoice.buyer?.city ?? invoice.site?.city, invoice.buyer?.state ?? invoice.site?.state, invoice.buyer?.pincode ?? invoice.site?.pincode].filter(Boolean).join(", ") || "Address not provided"}
          </p>
          <div className="pt-1 text-xs text-slate-500">
            <span className="font-semibold text-slate-700 dark:text-slate-300">GSTIN:</span>{" "}
            {invoice.buyer?.gstin ?? invoice.site?.gstin ?? "URP (Unregistered)"}
          </div>
        </section>

        <section className="posh-card space-y-2 p-5 text-sm">
          <h2 className="posh-card-title text-xs font-bold uppercase tracking-wider text-slate-500">Ship To (Site)</h2>
          <p className="font-bold text-slate-900 dark:text-slate-100">
            {invoice.site?.name ?? "Site Delivery"}
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            {[invoice.site?.addressLine, invoice.site?.city, invoice.site?.state, invoice.site?.pincode].filter(Boolean).join(", ") || "Address not provided"}
          </p>
          <div className="pt-1 text-xs text-slate-500">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Destination State:</span>{" "}
            {invoice.site?.state ?? invoice.placeOfSupplyStateName ?? "Tamil Nadu"} (Code: {invoice.placeOfSupplyStateCode ?? "33"})
          </div>
        </section>
      </div>

      <section className="posh-card space-y-3 p-6">
        <h2 className="posh-card-title">Products / Services</h2>
        <div className="divide-y divide-[color:var(--posh-border)] rounded-xl border" style={{ borderColor: "var(--posh-border)" }}>
          {invoice.lineItems.map((li, idx) => (
            <div key={li.id} className="flex flex-col gap-2 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">#{li.slNo ?? idx + 1}</span>
                  <p className="font-bold" style={{ color: "var(--posh-fg)" }}>{li.productName}</p>
                  {li.hsnCode ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      HSN {li.hsnCode}
                    </span>
                  ) : null}
                </div>
                <p className="posh-label mt-1">
                  {li.quantity} {li.uqc ?? li.unit ?? "Unit"} × ₹{li.unitPrice.toLocaleString("en-IN")}
                  {typeof li.taxRate === "number" ? (
                    isIntraState ? (
                      ` · CGST ${(li.cgstRate ?? li.taxRate / 2)}% + SGST ${(li.sgstRate ?? li.taxRate / 2)}% (Tax: ₹${li.taxAmount.toLocaleString("en-IN")})`
                    ) : (
                      ` · IGST ${(li.igstRate ?? li.taxRate)}% (Tax: ₹${li.taxAmount.toLocaleString("en-IN")})`
                    )
                  ) : ""}
                </p>
              </div>
              <p className="font-bold text-slate-900 dark:text-slate-100">
                ₹{Math.round(li.total).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-1.5 text-right text-sm">
          <p className="posh-subtitle">Subtotal (Assessable Value): ₹{invoice.subtotal.toLocaleString("en-IN")}</p>
          {invoice.freightChargeAmount !== 0 ? (
            <p className="posh-subtitle">Freight Charges (excl. GST): ₹{invoice.freightChargeAmount.toLocaleString("en-IN")}</p>
          ) : null}
          {invoice.otherChargesAmount !== 0 ? (
            <p className="posh-subtitle">Other Charges (excl. GST): ₹{invoice.otherChargesAmount.toLocaleString("en-IN")}</p>
          ) : null}
          {invoice.discountAmount !== 0 ? (
            <p className="posh-subtitle">Discount: -₹{invoice.discountAmount.toLocaleString("en-IN")}</p>
          ) : null}
          {invoice.freightChargeAmount !== 0 || invoice.otherChargesAmount !== 0 || invoice.discountAmount !== 0 ? (
            <p className="posh-subtitle font-medium">Taxable Value: ₹{invoice.taxableValue.toLocaleString("en-IN")}</p>
          ) : null}

          {/* Explicit CGST/SGST vs IGST Breakdown */}
          {isIntraState ? (
            <>
              <p className="posh-subtitle">
                CGST Total: ₹
                {(invoice.cgstAmount ?? Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="posh-subtitle">
                SGST Total: ₹
                {(invoice.sgstAmount ?? Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </>
          ) : (
            <p className="posh-subtitle">
              IGST Total: ₹
              {(invoice.igstAmount ?? invoice.taxAmount).toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          )}

          {invoice.roundingAdjustment !== 0 ? (
            <p className="posh-subtitle">
              Rounding: {invoice.roundingAdjustment > 0 ? "+" : "-"}₹
              {Math.abs(invoice.roundingAdjustment).toLocaleString("en-IN")}
            </p>
          ) : null}

          <div className="border-t pt-2" style={{ borderColor: "var(--posh-border)" }}>
            <p className="text-base font-bold" style={{ color: "var(--posh-fg)" }}>
              Total: ₹{Math.round(invoice.totalAmount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
            {invoice.totalInWords ? (
              <p className="mt-1 text-xs italic text-slate-500">{invoice.totalInWords}</p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Payment & Bank Settlement Section */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="posh-card space-y-2 p-5 text-sm">
          <h2 className="posh-card-title text-xs font-bold uppercase tracking-wider text-slate-500">Payment Summary</h2>
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            Invoice Amount: ₹{Math.round(invoice.totalAmount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
          <p className="font-medium text-slate-700 dark:text-slate-300">
            Payment Due By: <span className="font-semibold text-slate-900 dark:text-slate-100">{invoice.paymentDueBy ?? "Immediate"}</span>
          </p>
        </section>

        {invoice.bankDetails ? (
          <section className="posh-card space-y-1.5 p-5 text-xs text-slate-600 dark:text-slate-400">
            <h2 className="posh-card-title text-xs font-bold uppercase tracking-wider text-slate-500">Bank Settlement Details</h2>
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              {invoice.bankDetails.bankName} — A/C {invoice.bankDetails.accountNumber}
              {invoice.bankDetails.accountType ? ` (${invoice.bankDetails.accountType})` : ""}
            </p>
            <p>Account Name: {invoice.bankDetails.accountName}</p>
            <p>IFSC: {invoice.bankDetails.ifscCode} · Branch: {invoice.bankDetails.branch}</p>
            {invoice.bankDetails.bankAddress ? <p>Bank Address: {invoice.bankDetails.bankAddress}</p> : null}
          </section>
        ) : null}
      </div>

      <Link href={`/orders/${params.id}`} className="posh-btn-ghost inline-block">
        Back to Order
      </Link>
    </div>
  );
}
