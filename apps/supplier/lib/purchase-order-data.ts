import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";

export type SupplierPurchaseOrderRow = {
  id: string;
  poNumber: string;
  status: "DRAFT" | "ISSUED" | "ACKNOWLEDGED" | "FULFILLED";
  version: number;
  buyerName: string;
  orderId: string;
  total: number;
  itemCount: number;
  approvedAt: string | null;
  createdAt: string;
};

export type SupplierPurchaseOrderDetail = SupplierPurchaseOrderRow & {
  approvedBy: string | null;
  notes: string | null;
  lineItems: Array<{
    id: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    tax: number;
    deliveryDate: string | null;
    fulfilledQuantity: number;
    lineTotal: number;
  }>;
  exportUrl: string;
};

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

// UF-04 (supplier side): Purchase Orders issued by builders, awaiting/after acknowledgement.
// Mirrors apps/web PO data shape so both portals present a consistent, auditable PO record.
export async function getSupplierPurchaseOrders(email: string): Promise<SupplierPurchaseOrderRow[]> {
  const { supplierProfile } = await ensureSupplierContext(email);

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { supplierId: supplierProfile.id },
    include: {
      builder: true,
      lineItems: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return purchaseOrders.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    version: po.version,
    buyerName: po.builder.name ?? po.builder.email ?? "Builder",
    orderId: po.orderId,
    total: po.lineItems.reduce((acc, li) => acc + toNumber(li.unitPrice) * li.quantity + toNumber(li.tax), 0),
    itemCount: po.lineItems.length,
    approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
    createdAt: po.createdAt.toISOString(),
  }));
}

export async function getSupplierPurchaseOrderDetail(
  id: string,
  email: string
): Promise<SupplierPurchaseOrderDetail | null> {
  const { supplierProfile } = await ensureSupplierContext(email);

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, supplierId: supplierProfile.id },
    include: {
      builder: true,
      lineItems: { include: { product: true } },
    },
  });

  if (!po) return null;

  const lineItems = po.lineItems.map((li) => ({
    id: li.id,
    productName: li.product.name,
    unit: li.product.unit,
    quantity: li.quantity,
    unitPrice: toNumber(li.unitPrice),
    tax: toNumber(li.tax),
    deliveryDate: li.deliveryDate ? li.deliveryDate.toISOString() : null,
    fulfilledQuantity: li.fulfilledQuantity,
    lineTotal: toNumber(li.unitPrice) * li.quantity + toNumber(li.tax),
  }));

  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    version: po.version,
    buyerName: po.builder.name ?? po.builder.email ?? "Builder",
    orderId: po.orderId,
    total: lineItems.reduce((acc, li) => acc + li.lineTotal, 0),
    itemCount: lineItems.length,
    approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
    approvedBy: po.approvedBy,
    notes: po.notes,
    createdAt: po.createdAt.toISOString(),
    lineItems,
    exportUrl: `/api/builder/purchase-orders/${po.id}/export`,
  };
}

// Supplier-side acknowledgement: confirms receipt without needing anything outside the app.
export async function acknowledgeSupplierPurchaseOrder(id: string, email: string) {
  const { user, supplierProfile } = await ensureSupplierContext(email);

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, supplierId: supplierProfile.id },
  });

  if (!po) {
    throw new Error("Purchase order not found");
  }

  if (po.status !== "ISSUED") {
    throw new Error("Only issued purchase orders can be acknowledged");
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "ACKNOWLEDGED" },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "PURCHASE_ORDER_ACKNOWLEDGED",
      entityType: "PurchaseOrder",
      entityId: po.id,
      metadata: { poNumber: po.poNumber, orderId: po.orderId },
    },
  });

  return updated;
}
