import { SupplierInvoiceReview } from "@/components/admin/SupplierInvoiceReview";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type SupplierInvoiceDetail = {
  id: string;
  orderId: string;
  enquiryId: string;
  orderNumber: string | null;
  supplier: { id: string; companyName: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
  status: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";
  fileName: string;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: string | null;
  uploadedAt: string;
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
  rejectionReason: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  freightChargeAmount: number;
  otherChargesAmount: number;
  discountAmount: number;
  roundingAdjustment: number;
  confirmedTaxableValue: number | null;
  confirmedTaxAmount: number | null;
  confirmedTotalAmount: number | null;
  fileUrl: string;
  orderItems: Array<{
    id: string;
    productName: string | null;
    unitLabel: string | null;
    quantity: number;
    unitPrice: number;
    taxRatePercent: number | null;
  }>;
  lineItems: Array<{
    id: string;
    orderItemId: string;
    productName: string | null;
    orderUnitLabel: string | null;
    unitConfirmed: boolean;
    originalQuantity: number;
    originalUnitPrice: number;
    actualQuantity: number;
    approvedUnitPrice: number;
    supplierInvoicedUnitPrice: number | null;
    rateDiscrepancy: boolean;
    taxRatePercent: number | null;
    lineSubtotal: number;
    lineTaxAmount: number;
    lineTotal: number;
  }>;
};

export default async function SupplierInvoiceDetailPage({ params }: { params: { id: string } }) {
  await requireMenu("supplier-invoices");

  const invoice = await adminApiGet<SupplierInvoiceDetail>(`/admin/supplier-invoices/${params.id}`).catch(() => null);

  if (!invoice) {
    return (
      <div className="panel p-4">
        <p className="text-sm text-slate-600">Supplier invoice not found.</p>
      </div>
    );
  }

  return <SupplierInvoiceReview invoice={invoice} />;
}
