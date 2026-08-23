import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, Prisma } from "@matsrc/db";
import {
  prisma,
  formatCurrency,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";
import { createOrdersFromCart } from "@/lib/order-checkout";

export const dynamic = "force-dynamic";

// The "/orders" list (and the /newdashboard Active Orders / Delivered
// Orders stat cards) is filtered by a `?status=` query param. Alongside
// the real `OrderStatus` enum values (PLACED/PROCESSING/DISPATCHED/
// OUT_FOR_DELIVERY/DELIVERED/CANCELLED), two virtual/composite filter
// values are supported and translated into real enum conditions here —
// they must never be passed straight through to Prisma's `status` enum
// filter since they are not actual OrderStatus values:
//
//   ACTIVE           -> status NOT IN (CANCELLED, DELIVERED)
//                       ("Closed" is not a distinct OrderStatus in the
//                       current schema — see packages/db/prisma/schema.prisma
//                       — so there is nothing further to exclude for it yet.)
//   DELIVERED_CLOSED -> status = DELIVERED (kept only for backward
//                       compatibility with old dashboard links; behaves
//                       identically to `status=DELIVERED`, not
//                       Delivered+Closed, per current product requirement)
const ACTIVE_STATUS_FILTER = "ACTIVE";
const DELIVERED_OR_CLOSED_STATUS_FILTER = "DELIVERED_CLOSED";
const NON_ACTIVE_STATUSES: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.DELIVERED];

function resolveStatusWhere(rawStatus: string | null): Prisma.OrderWhereInput["status"] | undefined {
  if (!rawStatus) return undefined;
  const normalized = rawStatus.toUpperCase();

  if (normalized === ACTIVE_STATUS_FILTER) {
    return { notIn: NON_ACTIVE_STATUSES };
  }
  if (normalized === DELIVERED_OR_CLOSED_STATUS_FILTER) {
    return OrderStatus.DELIVERED;
  }
  if ((Object.values(OrderStatus) as string[]).includes(normalized)) {
    return normalized as OrderStatus;
  }
  // Unknown/invalid value: don't filter (safely falls back to "All").
  return undefined;
}

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const url = new URL(request.url);
    const statusWhere = resolveStatusWhere(url.searchParams.get("status"));

    const orders = await prisma.order.findMany({
      where: {
        userId: user.id,
        ...(statusWhere !== undefined ? { status: statusWhere } : {}),
      },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        createdAt: true,
        isAggregated: true,
        aggregationPoolId: true,
        siteId: true,
        site: { select: { id: true, name: true } },
        items: {

          select: {
            id: true,
            product: {
              select: {
                supplier: { select: { companyName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      orders.map((order) => ({
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        itemCount: order.items.length,
        total: Number(order.totalAmount),
        totalLabel: formatCurrency(order.totalAmount),
        createdAt: order.createdAt,
        isAggregated: order.isAggregated,
        aggregationPoolId: order.aggregationPoolId,
        supplierName: order.items[0]?.product.supplier.companyName ?? "Supplier",
        siteId: order.siteId,
        siteName: order.site?.name ?? "Unassigned",

        paymentLinkAvailable:
          order.status === OrderStatus.PROCESSING &&
          order.paymentStatus === PaymentStatus.PENDING,
        paymentLink: `/orders/${order.id}/payment`,
      }))
    );
  } catch (error) {
    console.error("Orders GET error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    // Cart -> grouped-by-supplier Order creation (UF-03 shared pipeline).
    // Also reused by the Quick Material Request nearest-match flow — see
    // apps/web/app/api/builder/quick-request/route.ts.
    const result = await createOrdersFromCart(user.id, {
      deliveryDate: body.deliveryDate,
      deliveryLat: typeof body.deliveryLat === "number" ? body.deliveryLat : null,
      deliveryLng: typeof body.deliveryLng === "number" ? body.deliveryLng : null,
      deliveryAddress: typeof body.deliveryAddress === "string" ? body.deliveryAddress : null,
      siteId: typeof body.siteId === "string" && body.siteId ? body.siteId : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ orders: result.orders }, { status: 201 });
  } catch (error) {
    console.error("Orders POST error:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
