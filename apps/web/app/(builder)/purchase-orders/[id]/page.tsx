import { notFound } from "next/navigation";
import { builderApiGet } from "@/lib/api";
import PurchaseOrderApprovalCard from "@/components/orders/PurchaseOrderApprovalCard";

type PurchaseOrderDetail = {
  id: string;
  poNumber: string;
  status: "DRAFT" | "ISSUED" | "ACKNOWLEDGED" | "FULFILLED";
  version: number;
  notes: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  orderId: string;
  supplier: { id: string; companyName: string };
  builder: { id: string; name: string; email: string };
  lineItems: Array<{
    id: string;
    productId: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    tax: number;
    deliveryDate: string | null;
    fulfilledQuantity: number;
    lineTotal: number;
  }>;
  total: number;
  exportUrl: string;
};

export default async function PurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  let po: PurchaseOrderDetail | null = null;

  try {
    po = await builderApiGet<PurchaseOrderDetail>(`/purchase-orders/${params.id}`);
  } catch {
    po = null;
  }

  if (!po) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Purchase Orders</p>
      <PurchaseOrderApprovalCard po={po} />
    </div>
  );
}
