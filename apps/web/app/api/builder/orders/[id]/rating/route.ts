import { NextResponse } from "next/server";
import { OrderStatus } from "@matsrc/db";
import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";

const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;

function isValidRating(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    if (!isValidRating(body.deliveryRating) || !isValidRating(body.qualityRating)) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "deliveryRating and qualityRating must be integers between 1 and 5" } },
        { status: 400 },
      );
    }

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      include: {
        items: {
          select: { supplierId: true },
          take: 1,
        },
        supplierRating: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, { status: 404 });
    }

    if (order.status !== OrderStatus.DELIVERED) {
      return NextResponse.json(
        { error: { code: "ORDER_NOT_DELIVERED", message: "Ratings are allowed only for delivered orders" } },
        { status: 400 },
      );
    }

    const supplierId = order.items[0]?.supplierId;
    if (!supplierId) {
      return NextResponse.json(
        { error: { code: "MISSING_SUPPLIER", message: "Supplier not found for this order" } },
        { status: 400 },
      );
    }

    const comment = typeof body.comment === "string" ? body.comment.trim() : null;

    if (order.supplierRating) {
      const canEditUntil = order.supplierRating.createdAt.getTime() + EDIT_WINDOW_MS;
      if (Date.now() > canEditUntil) {
        return NextResponse.json(
          { error: { code: "EDIT_WINDOW_EXPIRED", message: "Rating edit window has expired" } },
          { status: 400 },
        );
      }

      const updated = await prisma.supplierRating.update({
        where: { orderId: params.id },
        data: {
          deliveryRating: Number(body.deliveryRating),
          qualityRating: Number(body.qualityRating),
          comment,
        },
      });

      return NextResponse.json({
        id: updated.id,
        orderId: updated.orderId,
        updated: true,
      });
    }

    const created = await prisma.supplierRating.create({
      data: {
        orderId: params.id,
        supplierId,
        builderId: user.id,
        deliveryRating: Number(body.deliveryRating),
        qualityRating: Number(body.qualityRating),
        comment,
      },
    });

    return NextResponse.json(
      {
        id: created.id,
        orderId: created.orderId,
        updated: false,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Order rating POST error:", error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to save rating" } }, { status: 500 });
  }
}
