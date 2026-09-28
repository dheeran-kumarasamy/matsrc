import { PurchaseOrderStatus } from "@matsrc/db";

export function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export async function generatePoNumber(prisma: any): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseOrder.count({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01T00:00:00.000Z`),
        lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
      },
    },
  });
  const sequence = String(count + 1).padStart(5, "0");
  return `PO-${year}-${sequence}`;
}

export function serializePurchaseOrder(po: any) {
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    version: po.version,
    notes: po.notes,
    termsSnapshot: po.termsSnapshot,
    approvedAt: po.approvedAt,
    approvedBy: po.approvedBy,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
    orderId: po.orderId,
    // Meaningful Enquiry ID (e.g. "ABC-SITE01-000123") — only present when
    // the caller's query included the `order` relation (see
    // `purchaseOrderInclude` below). See packages/db/lib/enquiry-id.ts.
    enquiryId: po.order?.enquiryId ?? po.orderId,
    // Underlying Order.status (PLACED/PROCESSING/.../CANCELLED) — surfaced so
    // the PO screen can offer "Cancel Order" only when the order is still in
    // a builder-cancellable state, without a second round-trip. Only present
    // when the caller's query included the `order` relation.
    orderStatus: po.order?.status ?? null,
    // The order's tagged construction Site (nullable — "Unassigned" is
    // valid). Surfaced ONLY so the PO screen's "Create New Enquiry" action
    // can carry the same site forward into a fresh /sourcing session as a
    // convenience — it is never written back to this PO, and the sourcing
    // flow still fully re-validates ownership/ACTIVE status server-side
    // before ever persisting it (see session-store.ts's createSession).
    orderSiteId: po.order?.siteId ?? null,
    supplier: {
      id: po.supplier.id,
      companyName: po.supplier.companyName,
    },
    builder: {
      id: po.builder.id,
      name: po.builder.name,
      email: po.builder.email,
    },
    lineItems: po.lineItems.map((li: any) => ({
      id: li.id,
      productId: li.productId,
      productName: li.product.name,
      unit: li.product.unit,
      quantity: li.quantity,
      unitPrice: toNumber(li.unitPrice),
      tax: toNumber(li.tax),
      deliveryDate: li.deliveryDate,
      fulfilledQuantity: li.fulfilledQuantity,
      lineTotal: toNumber(li.unitPrice) * li.quantity + toNumber(li.tax),
    })),
    total: po.lineItems.reduce(
      (acc: number, li: any) => acc + toNumber(li.unitPrice) * li.quantity + toNumber(li.tax),
      0
    ),
    exportUrl: `/api/builder/purchase-orders/${po.id}/export`,
  };
}

export const purchaseOrderInclude = {
  supplier: true,
  builder: true,
  lineItems: { include: { product: true } },
  order: { select: { enquiryId: true, status: true, siteId: true } },
} as const;

export { PurchaseOrderStatus };
