import Link from "next/link";
import { notFound } from "next/navigation";
import { adminApiGet } from "@/lib/api";
import { requireAdminAccess } from "@/lib/rbac";
import { BUILDOHUB_COMPANY } from "@/lib/company-info";

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
  builder: { id: string; name: string | null; email: string | null; phone: string | null } | null;
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
  site: {
    id: string;
    name: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
  } | null;
  shipFrom?: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  shipTo?: { addressLine: string | null; city: string | null; state: string | null; pincode: string | null } | null;
  supplier?: { id: string; companyName: string; gstin: string | null; email: string | null; phone: string | null } | null;
  lineItems: Array<{
    id: string;
    slNo?: number;
    productName: string;
    description: string | null;
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
    supplierUnitPrice?: number | null;
    markupPercent?: number | null;
    markupAmount?: number | null;
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
  cessAmount?: number;
  taxAmount: number;
  totalAmount: number;
  totalInWords?: string;
  currency: string;
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
  generatedBy: { id: string; name: string | null; email: string | null } | null;
  generatedAt: string;
  // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) — null
  // when this invoice's calculated buyer payable/GST reconciled cleanly
  // against the frozen Order.finalPayableAmount/taxAmount snapshot.
  reconciliationDiscrepancy: {
    flaggedAt: string;
    expectedPayable: number | null;
    calculatedPayable: number | null;
    expectedTax: number | null;
    calculatedTax: number | null;
    reason: string | null;
  } | null;
};

type RatingDetail = {
  id: string;
  orderId: string;
  deliveryRating: number;
  qualityRating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  receipt: { fileName: string; mimeType: string | null; size: number | null; uploadedAt: string | null } | null;
};

// Admin invoice view — Form GST INV-01 / E-Invoice compliant document view.
// Every Admin/Super Admin can view any invoice. Displayed data comes entirely
// from the stored Invoice/InvoiceLineItem snapshot — never recomputed from
// live order/product pricing.
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

  const rating = await adminApiGet<RatingDetail>(`/admin/ratings/${params.orderId}`).catch(() => null);

  const sellerStateCode = invoice.sellerStateCode ?? "33";
  const posCode = invoice.placeOfSupplyStateCode ?? sellerStateCode;
  const posName = invoice.placeOfSupplyStateName ?? "Tamil Nadu";
  const isIntraState = sellerStateCode === posCode;

  const hasAdjustments =
    invoice.freightChargeAmount !== 0 ||
    invoice.otherChargesAmount !== 0 ||
    invoice.discountAmount !== 0 ||
    invoice.roundingAdjustment !== 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Platform identity Header */}
      <div className="panel p-4 text-sm text-slate-600">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-base font-extrabold text-slate-950">{BUILDOHUB_COMPANY.name}</p>
            <p className="font-semibold text-slate-800">{BUILDOHUB_COMPANY.legalName}</p>
            <p>
              {[BUILDOHUB_COMPANY.addressLine, BUILDOHUB_COMPANY.city, BUILDOHUB_COMPANY.state, BUILDOHUB_COMPANY.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
            <p className="font-medium text-slate-800">
              GSTIN: {BUILDOHUB_COMPANY.gstin} · State Code: {sellerStateCode} (Tamil Nadu)
            </p>
          </div>
          <div className="text-right">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
              {invoice.documentType ?? "INV"} / TAX INVOICE
            </span>
          </div>
        </div>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tax Invoice</p>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              Supply: {invoice.supplyType ?? "B2B"}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              Rev. Charge: {invoice.reverseCharge ? "Yes" : "No"}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">{invoice.invoiceNumber}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Date: {new Date(invoice.invoiceDate).toLocaleDateString("en-IN")} · Ref: #{invoice.enquiryId} · Place of Supply:{" "}
            {posCode} - {posName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/admin/orders/${params.orderId}/invoice/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            Download Invoice PDF
          </a>
          <a
            href={`/api/admin/orders/${params.orderId}/site-receipt-sheet/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            title="Download Site Material Receipt & Verification Sheet (DC / Non-financial)"
          >
            Download Site Receipt (DC)
          </a>
        </div>
      </header>

      {/* Reconciliation discrepancy warning (Admin-only) */}
      {invoice.reconciliationDiscrepancy ? (
        <section className="panel border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-sm font-extrabold text-amber-900">⚠ Reconciliation discrepancy flagged for review</p>
          <p className="mt-1 text-xs text-amber-800">{invoice.reconciliationDiscrepancy.reason}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-amber-900">
            <p>
              Expected (frozen) payable: ₹
              {invoice.reconciliationDiscrepancy.expectedPayable?.toLocaleString("en-IN") ?? "—"}
            </p>
            <p>
              Calculated invoice total: ₹
              {invoice.reconciliationDiscrepancy.calculatedPayable?.toLocaleString("en-IN") ?? "—"}
            </p>
            <p>
              Expected (frozen) GST: ₹{invoice.reconciliationDiscrepancy.expectedTax?.toLocaleString("en-IN") ?? "—"}
            </p>
            <p>
              Calculated GST: ₹{invoice.reconciliationDiscrepancy.calculatedTax?.toLocaleString("en-IN") ?? "—"}
            </p>
          </div>
          <p className="mt-2 text-xs text-amber-700">
            Flagged {new Date(invoice.reconciliationDiscrepancy.flaggedAt).toLocaleString("en-IN")}. The frozen order
            amounts and this invoice's totals have NOT been altered — this is informational only.
          </p>
        </section>
      ) : null}

      {/* 2-Column Parties Grid: Bill To & Ship To */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="panel space-y-2 p-5 text-sm">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Bill To (Recipient)</h2>
          <p className="font-bold text-slate-900">
            {invoice.buyer?.legalName ?? invoice.builder?.name ?? "Contractor / Client"}
          </p>
          {invoice.buyer?.tradeName ? <p className="text-xs text-slate-500">{invoice.buyer.tradeName}</p> : null}
          <p className="text-slate-600">
            {[
              invoice.buyer?.addressLine ?? invoice.site?.addressLine,
              invoice.buyer?.city ?? invoice.site?.city,
              invoice.buyer?.state ?? invoice.site?.state,
              invoice.buyer?.pincode ?? invoice.site?.pincode,
            ]
              .filter(Boolean)
              .join(", ") || "Address not provided"}
          </p>
          <div className="pt-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">GSTIN:</span>{" "}
            {invoice.buyer?.gstin ?? invoice.site?.gstin ?? "URP (Unregistered)"} ·{" "}
            <span className="font-semibold text-slate-800">State:</span>{" "}
            {invoice.buyer?.state ?? posName} ({invoice.buyer?.stateCode ?? posCode})
          </div>
        </section>

        <section className="panel space-y-2 p-5 text-sm">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Ship To (Site Delivery)</h2>
          <p className="font-bold text-slate-900">{invoice.site?.name ?? "Site Delivery"}</p>
          <p className="text-slate-600">
            {[
              invoice.shipTo?.addressLine ?? invoice.site?.addressLine,
              invoice.shipTo?.city ?? invoice.site?.city,
              invoice.shipTo?.state ?? invoice.site?.state,
              invoice.shipTo?.pincode ?? invoice.site?.pincode,
            ]
              .filter(Boolean)
              .join(", ") || "Address not provided"}
          </p>
          <div className="pt-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Destination State:</span>{" "}
            {invoice.shipTo?.state ?? posName} ({posCode})
          </div>
          {invoice.shipFrom?.state ? (
            <p className="text-xs text-slate-500">Dispatch Origin: {invoice.shipFrom.state}</p>
          ) : null}
        </section>
      </div>

      {/* Products / Services Section */}
      <section className="panel p-5">
        <h2 className="text-lg font-bold text-slate-950">Line Items (Goods & Services)</h2>
        <div className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {invoice.lineItems.map((li, idx) => (
            <div key={li.id} className="p-4 text-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">#{li.slNo ?? idx + 1}</span>
                    <p className="font-bold text-slate-900">{li.productName}</p>
                    {li.hsnCode ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                        HSN {li.hsnCode}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {li.quantity} {li.uqc ?? li.unit ?? "Unit"} × ₹{li.unitPrice.toLocaleString("en-IN")} · Taxable: ₹
                    {(li.taxableAmount ?? li.subtotal).toLocaleString("en-IN")}
                    {typeof li.taxRate === "number" ? (
                      isIntraState ? (
                        ` · CGST ${(li.cgstRate ?? li.taxRate / 2)}% (₹${(li.cgstAmount ?? Math.round(li.taxAmount / 2)).toLocaleString("en-IN")}) + SGST ${(li.sgstRate ?? li.taxRate / 2)}% (₹${(li.sgstAmount ?? Math.round(li.taxAmount / 2)).toLocaleString("en-IN")})`
                      ) : (
                        ` · IGST ${(li.igstRate ?? li.taxRate)}% (₹${(li.igstAmount ?? li.taxAmount).toLocaleString("en-IN")})`
                      )
                    ) : ""}
                  </p>
                  {/* Admin-only markup traceability */}
                  {li.supplierUnitPrice !== null && li.supplierUnitPrice !== undefined ? (
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      Settlement: ₹{li.supplierUnitPrice.toLocaleString("en-IN")} · Markup: {li.markupPercent ?? 0}% (+₹
                      {(li.markupAmount ?? 0).toLocaleString("en-IN")})
                    </p>
                  ) : null}
                </div>
                <p className="font-bold text-slate-900">
                  ₹{Math.round(li.total).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Totals Breakdown */}
        <div className="mt-4 space-y-1.5 text-right text-sm">
          <p className="text-slate-600">Subtotal (Assessable Value): ₹{invoice.subtotal.toLocaleString("en-IN")}</p>
          {invoice.freightChargeAmount !== 0 ? (
            <p className="text-slate-600">Freight Charges (excl. GST): ₹{invoice.freightChargeAmount.toLocaleString("en-IN")}</p>
          ) : null}
          {invoice.otherChargesAmount !== 0 ? (
            <p className="text-slate-600">Other Charges (excl. GST): ₹{invoice.otherChargesAmount.toLocaleString("en-IN")}</p>
          ) : null}
          {invoice.discountAmount !== 0 ? (
            <p className="text-slate-600">Discount: -₹{invoice.discountAmount.toLocaleString("en-IN")}</p>
          ) : null}
          {hasAdjustments ? (
            <p className="font-semibold text-slate-800">
              Total Taxable Value: ₹{invoice.taxableValue.toLocaleString("en-IN")}
            </p>
          ) : null}

          {/* Tax Splits */}
          {isIntraState ? (
            <>
              <p className="text-slate-600">
                CGST Total: ₹
                {(invoice.cgstAmount ?? Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-slate-600">
                SGST Total: ₹
                {(invoice.sgstAmount ?? Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </>
          ) : (
            <p className="text-slate-600">
              IGST Total: ₹
              {(invoice.igstAmount ?? invoice.taxAmount).toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          )}

          {invoice.roundingAdjustment !== 0 ? (
            <p className="text-slate-600">
              Rounding: {invoice.roundingAdjustment > 0 ? "+" : "-"}₹
              {Math.abs(invoice.roundingAdjustment).toLocaleString("en-IN")}
            </p>
          ) : null}

          <div className="border-t border-slate-200 pt-2">
            <p className="text-base font-extrabold text-slate-950">
              Grand Total: ₹{Math.round(invoice.totalAmount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
            {invoice.totalInWords ? (
              <p className="mt-1 text-xs italic text-slate-600">{invoice.totalInWords}</p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Payment & Settlement Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="panel space-y-2 p-5 text-sm">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Payment Summary</h2>
          <p className="font-semibold text-slate-900">
            Invoice Amount: ₹{Math.round(invoice.totalAmount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
          <p className="font-medium text-slate-700">
            Payment Due By: <span className="font-semibold text-slate-950">{invoice.paymentDueBy ?? "Immediate"}</span>
          </p>
        </section>

        {invoice.bankDetails ? (
          <section className="panel space-y-1.5 p-5 text-xs text-slate-600">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Bank Settlement Details</h2>
            <p className="font-semibold text-slate-900">
              {invoice.bankDetails.bankName} · A/C {invoice.bankDetails.accountNumber}
              {invoice.bankDetails.accountType ? ` (${invoice.bankDetails.accountType})` : ""}
            </p>
            <p>Account Name: {invoice.bankDetails.accountName}</p>
            <p>
              IFSC: {invoice.bankDetails.ifscCode} · Branch: {invoice.bankDetails.branch}
            </p>
            {invoice.bankDetails.bankAddress ? <p>Bank Address: {invoice.bankDetails.bankAddress}</p> : null}
          </section>
        ) : null}
      </div>

      <p className="text-xs text-slate-500">
        Generated by {invoice.generatedBy?.name ?? invoice.generatedBy?.email ?? "Admin"} on{" "}
        {new Date(invoice.generatedAt).toLocaleString("en-IN")}
      </p>

      {rating ? (
        <section className="panel p-5">
          <h2 className="text-lg font-bold text-slate-950">Supplier Rating</h2>
          <p className="mt-1 text-sm text-slate-600">
            Delivery: {rating.deliveryRating}/5 · Quality: {rating.qualityRating}/5
          </p>
          {rating.comment ? <p className="mt-1 text-sm italic text-slate-600">"{rating.comment}"</p> : null}

          {rating.receipt ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                {rating.receipt.fileName}
              </span>
              <a
                href={`/api/admin/ratings/${params.orderId}/receipt`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
              >
                View/Download Receipt
              </a>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No receipt was uploaded for this rating.</p>
          )}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/api/admin/orders/${params.orderId}/rfq-pdf`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
        >
          Download RFQ PDF
        </a>
        <Link href="/payments" className="inline-block text-sm font-semibold text-slate-700 underline">
          Back to Payments
        </Link>
      </div>
    </div>
  );
}
