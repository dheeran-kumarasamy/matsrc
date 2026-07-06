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
} as const;

export { PurchaseOrderStatus };
