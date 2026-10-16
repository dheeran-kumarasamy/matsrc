import { NextResponse } from "next/server";
import { PurchaseOrderStatus } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import {
  serializePurchaseOrder,
  purchaseOrderInclude,
  generatePoNumber,
  buildPurchaseOrderLineItemData,
  isPurchaseOrderEligibleOrderStatus,
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

    // Purchase-Order Generation Eligibility (Phase 5B) — see
    // isPurchaseOrderEligibleOrderStatus's own doc comment
    // (lib/purchase-order-utils.ts) for the full trace of why `status`
    // (rather than quoteSelectionCompletedAt/selectedSupplierId) is the
    // correct, already-persisted signal of genuine confirmation across
    // ALL FOUR existing confirmation paths — not just the two RFQ-style
    // ones that happen to set those two fields.
    if (!isPurchaseOrderEligibleOrderStatus(order.status)) {
      return NextResponse.json(
        {
          error:
            order.status === "CANCELLED"
              ? "This order has been cancelled and can no longer have a purchase order generated"
              : "Purchase order can only be created after this enquiry has been confirmed by a supplier or payment has been approved",
        },
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

    // Supplier resolution (Phase 5B) — order.selectedSupplierId is ONLY
    // ever populated by the two RFQ-style confirmation paths (see
    // isPurchaseOrderEligibleOrderStatus's doc comment). For an order
    // confirmed via OrdersService.updateStatus or PaymentsService.approve
    // (which never set it), fall back to the order's own, already-frozen
    // OrderItem.supplierId — mirrors apps/api's PurchaseOrdersService.create
    // identical fallback exactly, rather than inventing a second rule.
    let supplierId: string | null = order.selectedSupplierId;
    if (!supplierId) {
      const supplierIds = new Set(order.items.map((item) => item.supplierId));
      if (supplierIds.size > 1) {
        return NextResponse.json(
          { error: "This order spans multiple suppliers and cannot be represented as a single purchase order" },
          { status: 400 }
        );
      }
      supplierId = order.items[0].supplierId;
    }

    const poNumber = await generatePoNumber(prisma);

    const created = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        builderId: user.id,
        supplierId,
        orderId: order.id,
        status: PurchaseOrderStatus.DRAFT,
        version: 1,
        termsSnapshot: {
          paymentMethod: order.paymentMethod,
          bestPriceTotal: order.bestPriceTotal ? Number(order.bestPriceTotal) : null,
          tentativeDeliveryDate: order.tentativeDeliveryDate,
        },
        lineItems: {
          // Verify and Fix PO Generation to Use Accepted Supplier RFQ Price:
          // see buildPurchaseOrderLineItemData's doc comment — unitPrice is
          // read as-is from the already-accepted OrderItem.unitPrice, never
          // re-derived from catalogue/tier pricing.
          create: order.items.map((item) =>
            buildPurchaseOrderLineItemData(item as any, order.tentativeDeliveryDate)
          ),
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
