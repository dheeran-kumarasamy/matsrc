import { NextResponse } from "next/server";
import { PurchaseOrderStatus } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { serializePurchaseOrder, purchaseOrderInclude } from "@/lib/purchase-order-utils";

export const dynamic = "force-dynamic";

// GET /api/builder/purchase-orders/[id] — fetch PO detail (incl. export link).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: purchaseOrderInclude,
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json(serializePurchaseOrder(po));
  } catch (error) {
    console.error("Purchase order GET error:", error);
    return NextResponse.json({ error: "Failed to fetch purchase order" }, { status: 500 });
  }
}

// PATCH /api/builder/purchase-orders/[id] — edit quantity/delivery date/notes while in Draft state only.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: { lineItems: true },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      return NextResponse.json(
        { error: "Purchase order can only be edited while in Draft state" },
        { status: 403 }
      );
    }

    if (typeof body.notes === "string" || body.notes === null) {
      await prisma.purchaseOrder.update({
        where: { id: params.id },
        data: { notes: body.notes },
      });
    }

    const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
    if (lineItems.length) {
      const validIds = new Set(po.lineItems.map((li) => li.id));
      for (const lineItem of lineItems) {
        if (!lineItem || typeof lineItem.id !== "string" || !validIds.has(lineItem.id)) {
          return NextResponse.json(
            { error: `Line item ${lineItem?.id ?? ""} does not belong to this purchase order` },
            { status: 400 }
          );
        }

        const data: any = {};
        if (typeof lineItem.quantity === "number" && Number.isInteger(lineItem.quantity) && lineItem.quantity >= 1) {
          data.quantity = lineItem.quantity;
        }
        if (typeof lineItem.deliveryDate === "string" && lineItem.deliveryDate) {
          data.deliveryDate = new Date(lineItem.deliveryDate);
        }

        if (Object.keys(data).length) {
          await prisma.purchaseOrderLineItem.update({
            where: { id: lineItem.id },
            data,
          });
        }
      }
    }

    const updated = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: purchaseOrderInclude,
    });

    return NextResponse.json(serializePurchaseOrder(updated));
  } catch (error) {
    console.error("Purchase order PATCH error:", error);
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 });
  }
}
