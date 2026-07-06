import { NextResponse } from "next/server";
import { PurchaseOrderStatus } from "@matsrc/db";
import { prisma } from "@/lib/builder-db";
import { serializePurchaseOrder, purchaseOrderInclude } from "@/lib/purchase-order-utils";

export const dynamic = "force-dynamic";

// POST /api/builder/purchase-orders/[id]/acknowledge
// Supplier-side acknowledgement, mirrored under the builder web app so the demo/
// mock supplier flow can confirm receipt entirely in-app (no external tools).
// The dedicated GET /supplier/purchase-orders/:id/acknowledge described in scope
// is served by the NestJS API for the standalone supplier portal; this route lets
// the shared Prisma-backed web app exercise the same transition for local/demo use.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: params.id },
      include: purchaseOrderInclude,
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    if (po.status !== PurchaseOrderStatus.ISSUED) {
      return NextResponse.json(
        { error: "Only issued purchase orders can be acknowledged" },
        { status: 400 }
      );
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: { status: PurchaseOrderStatus.ACKNOWLEDGED },
      include: purchaseOrderInclude,
    });

    await prisma.auditLog.create({
      data: {
        actorId: po.supplierId,
        action: "PURCHASE_ORDER_ACKNOWLEDGED",
        entityType: "PurchaseOrder",
        entityId: po.id,
        metadata: { poNumber: po.poNumber, orderId: po.orderId },
      },
    });

    return NextResponse.json(serializePurchaseOrder(updated));
  } catch (error) {
    console.error("Purchase order acknowledge error:", error);
    return NextResponse.json({ error: "Failed to acknowledge purchase order" }, { status: 500 });
  }
}
