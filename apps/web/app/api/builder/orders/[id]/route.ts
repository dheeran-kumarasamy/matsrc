import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, PaymentMethod } from "@matsrc/db";
import {
  prisma,
  formatCurrency,
  formatDate,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export const dynamic = "force-dynamic";


export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        totalAmount: true,
        deliveryDate: true,
        quoteSelectionCompletedAt: true,
        isAggregated: true,
        aggregationPoolId: true,
        priceBeforeAggregation: true,
        priceAfterAggregation: true,
        aggregationPool: {
          select: { status: true },
        },
        purchaseOrders: {
          select: { id: true, poNumber: true, status: true, version: true },
          orderBy: { version: "desc" },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                supplier: { select: { id: true, companyName: true } },
              },
            },
          },
        },
        tracking: {
          select: {
            id: true,
            status: true,
            note: true,
            recordedAt: true,
          },
          orderBy: { recordedAt: "asc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // REQ-10: Bank Guarantee is only offered as a payment method choice if the
    // builder has an APPROVED/ACTIVE bank guarantee registered (REQ-09).
    const creditProfile = await prisma.creditProfile.findUnique({
      where: { userId: user.id },
      select: { bankGuaranteeEnabled: true, bankGuaranteeStatus: true },
    });
    const bankGuaranteeAvailable =
      Boolean(creditProfile?.bankGuaranteeEnabled) &&
      (creditProfile?.bankGuaranteeStatus === "APPROVED" || creditProfile?.bankGuaranteeStatus === "ACTIVE");

    return NextResponse.json({
      id: order.id,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentLinkAvailable:
        order.status === OrderStatus.PROCESSING &&
        order.paymentStatus === PaymentStatus.PENDING,
      paymentLink: `/orders/${order.id}/payment`,
      bankGuaranteeAvailable,

      supplierId: order.items[0]?.product.supplier.id ?? null,
      primaryListingId: order.items[0]?.product.id ?? null,
      total: Number(order.totalAmount),
      totalLabel: formatCurrency(order.totalAmount),
      deliveryDate: formatDate(order.deliveryDate),
      supplierName: order.items[0]?.product.supplier.companyName ?? "Supplier",
      // PO trigger point: available once a supplier quote has been accepted for this enquiry.
      quoteAccepted: Boolean(order.quoteSelectionCompletedAt),
      isAggregated: order.isAggregated,
      aggregationPoolId: order.aggregationPoolId,
      poolLocked: order.aggregationPool?.status === "LOCKED" || order.aggregationPool?.status === "FULFILLING" || order.aggregationPool?.status === "CLOSED",
      priceBeforeAggregation: order.priceBeforeAggregation ? Number(order.priceBeforeAggregation) : null,
      priceAfterAggregation: order.priceAfterAggregation ? Number(order.priceAfterAggregation) : null,

      purchaseOrder: order.purchaseOrders[0]
        ? {
            id: order.purchaseOrders[0].id,
            poNumber: order.purchaseOrders[0].poNumber,
            status: order.purchaseOrders[0].status,
            version: order.purchaseOrders[0].version,
          }
        : null,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice: Number(item.unitPrice),
      })),
      tracking: order.tracking.map((step) => ({
        id: step.id,
        status: step.status,
        label: step.note || step.status,
        recordedAt: step.recordedAt,
      })),
    });
  } catch (error) {
    console.error("Order GET error:", error);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}

// PATCH /api/builder/orders/[id]
// REQ-10: Lets the builder choose Standard (BANK_TRANSFER) vs Bank Guarantee
// (CREDIT) as the payment method for this order, from the payment page.
// Bank Guarantee is only accepted if the builder's CreditProfile has an
// APPROVED/ACTIVE bank guarantee registered (REQ-09 gate), re-checked here
// server-side regardless of what the client sends.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const { paymentMethod } = body as { paymentMethod?: string };

    if (paymentMethod !== "BANK_TRANSFER" && paymentMethod !== "CREDIT") {
      return NextResponse.json(
        { error: "paymentMethod must be BANK_TRANSFER or CREDIT" },
        { status: 400 }
      );
    }

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, paymentStatus: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      return NextResponse.json(
        { error: "Payment method cannot be changed after payment is completed" },
        { status: 400 }
      );
    }

    if (paymentMethod === "CREDIT") {
      const creditProfile = await prisma.creditProfile.findUnique({
        where: { userId: user.id },
        select: { bankGuaranteeEnabled: true, bankGuaranteeStatus: true },
      });
      const eligible =
        Boolean(creditProfile?.bankGuaranteeEnabled) &&
        (creditProfile?.bankGuaranteeStatus === "APPROVED" || creditProfile?.bankGuaranteeStatus === "ACTIVE");
      if (!eligible) {
        return NextResponse.json(
          { error: "Bank Guarantee is not approved for this account yet" },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { paymentMethod: paymentMethod as PaymentMethod },
      select: { id: true, paymentMethod: true },
    });

    return NextResponse.json({ id: updated.id, paymentMethod: updated.paymentMethod });
  } catch (error) {
    console.error("Order PATCH error:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}

