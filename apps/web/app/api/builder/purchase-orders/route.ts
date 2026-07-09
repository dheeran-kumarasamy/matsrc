import { NextResponse } from "next/server";
import { PurchaseOrderStatus } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import {
  serializePurchaseOrder,
  purchaseOrderInclude,
  generatePoNumber,
} from "@/lib/purchase-order-utils";
import { notifySupplierPurchaseOrderGenerated } from "@/lib/notify";


export const dynamic = "force-dynamic";

// GET /api/builder/purchase-orders?status=DRAFT — list POs for the builder, UF-04 PO history.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");

    const where: any = { builderId: user.id };
    if (statusParam && Object.values(PurchaseOrderStatus).includes(statusParam as PurchaseOrderStatus)) {
      where.status = statusParam as PurchaseOrderStatus;
    }

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where,
      include: purchaseOrderInclude,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(purchaseOrders.map(serializePurchaseOrder));
  } catch (error) {
    console.error("Purchase orders GET error:", error);
    return NextResponse.json({ error: "Failed to fetch purchase orders" }, { status: 500 });
  }
}

// POST /api/builder/purchase-orders — auto-generate a draft PO from an accepted enquiry/quote.
// Reuses cart/enquiry + supplier quote data already on the Order — no manual re-entry.
export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const orderId = typeof body.orderId === "string" ? body.orderId : "";

    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      include: {
        items: { include: { product: true, supplier: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Enquiry/order not found" }, { status: 404 });
    }

    // Trigger point: PO creation only available once a supplier has confirmed a quote.
    if (!order.quoteSelectionCompletedAt || !order.selectedSupplierId) {
      return NextResponse.json(
        { error: "Purchase order can only be created after a supplier quote has been accepted for this enquiry" },
        { status: 400 }
      );
    }

    // Idempotent: if a PO already exists for this order, return the latest version instead of duplicating.
    const existing = await prisma.purchaseOrder.findFirst({
      where: { orderId: order.id, builderId: user.id },
      include: purchaseOrderInclude,
      orderBy: { version: "desc" },
    });

    if (existing) {
      return NextResponse.json(serializePurchaseOrder(existing));
    }

    if (!order.items.length) {
      return NextResponse.json({ error: "Enquiry has no line items" }, { status: 400 });
    }

    const poNumber = await generatePoNumber(prisma);

    const created = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        builderId: user.id,
        supplierId: order.selectedSupplierId,
        orderId: order.id,
        status: PurchaseOrderStatus.DRAFT,
        version: 1,
        termsSnapshot: {
          paymentMethod: order.paymentMethod,
          bestPriceTotal: order.bestPriceTotal ? Number(order.bestPriceTotal) : null,
          tentativeDeliveryDate: order.tentativeDeliveryDate,
        },
        lineItems: {
          create: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            tax: 0,
            deliveryDate: item.deliveryDate ?? order.tentativeDeliveryDate ?? null,
          })),
        },
      },
      include: purchaseOrderInclude,
    });

    // Best-effort WhatsApp notification to the supplier — must never block PO creation.
    void notifySupplierPurchaseOrderGenerated(created.id).catch(() => undefined);

    return NextResponse.json(serializePurchaseOrder(created), { status: 201 });

  } catch (error) {
    console.error("Purchase orders POST error:", error);
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 });
  }
}
