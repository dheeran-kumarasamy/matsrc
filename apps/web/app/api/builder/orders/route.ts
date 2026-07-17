import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, PaymentMethod } from "@matsrc/db";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  formatDate,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";
import { notifySupplierOrderSubmitted } from "@/lib/notify";
import {
  resolveLowestPriceForQuantity,
  resolvePriceRange,
  type ResolutionCandidate,
} from "@/lib/resolution";



export const dynamic = "force-dynamic";

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

type SupplierListing = {
  id: string;
  price: string;
  stock: string;
  maxServiceableQty?: string;
  active: boolean;
  canonicalProductId?: string | null;
  groupedListingIds?: string[];
  headlineSupplierId?: string;
  basePriceRaw?: number;
  stockRaw?: number;
  maxServiceableQtyRaw?: number;
  pricingTiersRaw?: { minQty: number; maxQty: number; tierPrice: number }[];
};

function parseNumberLabel(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseQuantityLabel(value: string) {
  const numeric = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchAllSupplierListings(): Promise<SupplierListing[]> {
  try {
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings`, { cache: "no-store" });
    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return [];

    return (await response.json()) as SupplierListing[];
  } catch {
    return [];
  }
}

function toResolutionCandidate(listing: SupplierListing): ResolutionCandidate {
  const pricingTiers =
    Array.isArray(listing.pricingTiersRaw) && listing.pricingTiersRaw.length > 0
      ? listing.pricingTiersRaw
      : [
          {
            minQty: 1,
            maxQty:
              listing.maxServiceableQtyRaw ??
              (listing.maxServiceableQty ? parseQuantityLabel(listing.maxServiceableQty) : parseQuantityLabel(listing.stock)),
            tierPrice: listing.basePriceRaw ?? parseNumberLabel(listing.price),
          },
        ];

  return {
    listingId: listing.id,
    supplierId: listing.headlineSupplierId ?? "",
    basePrice: listing.basePriceRaw ?? parseNumberLabel(listing.price),
    stock: listing.stockRaw ?? parseQuantityLabel(listing.stock),
    maxServiceableQty:
      listing.maxServiceableQtyRaw ??
      (listing.maxServiceableQty ? parseQuantityLabel(listing.maxServiceableQty) : parseQuantityLabel(listing.stock)),
    pricingTiers,
    isActive: listing.active,
  };
}

/**
 * Re-resolves, at checkout time (per spec: "re-resolve at checkout"), which
 * specific listing in a canonical product's cross-supplier group currently
 * offers the lowest price for the given quantity. Falls back to null if the
 * listing isn't found among the currently fetched public listings (e.g. a
 * legacy/local-only mirrored product with no live supplier listing).
 */
function resolveForProductId(
  productId: string,
  canonicalProductId: string | null | undefined,
  allListings: SupplierListing[],
  quantity: number
) {
  const matched = allListings.find((item) => item.id === productId);

  const groupIds = new Set(
    matched?.groupedListingIds && matched.groupedListingIds.length > 0
      ? matched.groupedListingIds
      : canonicalProductId
        ? allListings.filter((item) => item.canonicalProductId === canonicalProductId).map((item) => item.id)
        : matched
          ? [matched.id]
          : []
  );

  const group = allListings.filter((item) => groupIds.has(item.id));
  if (group.length === 0) return { resolution: null, minPrice: null as number | null };

  const candidates = group.map(toResolutionCandidate);
  const resolution = resolveLowestPriceForQuantity(candidates, quantity);

  // REQ-06: the "ask price" sent to the supplier must be the floor of the
  // full min–max price range shown to the builder across the canonical
  // group (not the quantity-tiered resolved price) — re-uses the same
  // range computation that powers the customer-facing product card.
  const range = resolvePriceRange(candidates);

  return { resolution, minPrice: range?.minPrice ?? null };
}


export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        createdAt: true,
        isAggregated: true,
        aggregationPoolId: true,
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

    const cartItems = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            supplierId: true,
            canonicalProductId: true,
            basePrice: true,
            supplier: { select: { companyName: true } },
            pricingTiers: {
              select: { minQty: true, maxQty: true, tierPrice: true },
              orderBy: { minQty: "asc" },
            },
          },
        },
      },
    });

    if (!cartItems.length) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Re-resolve each cart item's canonical group fresh against the latest
    // supplier listings (spec: "re-resolve at checkout" — prices/stock may
    // have changed since add-to-cart). Falls back to the item's own
    // supplier/product pricing if no live resolution is available (e.g.
    // legacy local-only product with no matching public listing).
    const allListings = await fetchAllSupplierListings();

    type ResolvedLine = {
      productId: string;
      quantity: number;
      unitPrice: number;
      askPrice: number | null;
      supplierId: string;
      supplierName: string;
      canonicalProductId: string | null;
      resolvedListingId: string | null;
      tierMinQty: number | null;
      tierMaxQty: number | null;
    };

    const resolvedLines: ResolvedLine[] = cartItems.map((item) => {
      const { resolution, minPrice } = resolveForProductId(
        item.productId,
        item.product.canonicalProductId,
        allListings,
        item.quantity
      );

      if (resolution && resolution.supplierId) {
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: resolution.unitPrice,
          // REQ-06: askPrice is the minimum of the full canonical price
          // range shown to the builder — the only price figure surfaced
          // to the supplier. Falls back to the resolved unitPrice if no
          // range could be computed (e.g. single-listing canonical group).
          askPrice: minPrice ?? resolution.unitPrice,
          supplierId: resolution.supplierId,
          supplierName: item.product.supplier.companyName,
          canonicalProductId: item.product.canonicalProductId,
          resolvedListingId: resolution.listingId,
          tierMinQty: resolution.tierMinQty,
          tierMaxQty: resolution.tierMaxQty,
        };
      }

      // Fallback: legacy single-listing pricing, grouped by the item's own
      // product/supplier (unchanged pre-resolution behaviour).
      const fallbackUnitPrice = resolveUnitPrice(item.product, item.quantity);
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: fallbackUnitPrice,
        askPrice: minPrice ?? fallbackUnitPrice,
        supplierId: item.product.supplierId,
        supplierName: item.product.supplier.companyName,
        canonicalProductId: item.product.canonicalProductId,
        resolvedListingId: null,
        tierMinQty: null,
        tierMaxQty: null,
      };
    });


    // Group by the RESOLVED supplier (routing-bug fix: an enquiry must be
    // assigned to the specific supplier whose price is lowest for the tier
    // the builder selected — not just whichever card/listing they clicked).
    const groups = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        items: ResolvedLine[];
      }
    >();

    for (const line of resolvedLines) {
      const group = groups.get(line.supplierId) ?? {
        supplierId: line.supplierId,
        supplierName: line.supplierName,
        items: [],
      };
      group.items.push(line);
      groups.set(line.supplierId, group);
    }

    const createdOrders = [];

    for (const group of groups.values()) {
      const totalAmount = group.items.reduce(
        (acc, item) => acc + item.unitPrice * item.quantity,
        0
      );
      const deliveryDate = body.deliveryDate ? new Date(body.deliveryDate) : null;
      // REQ-07: map-based geolocation capture, replacing the checkout pincode
      // field. All optional/nullable — existing flows that don't send these
      // (e.g. the separate Group & Save checkout page) are unaffected.
      const deliveryLat = typeof body.deliveryLat === "number" ? body.deliveryLat : null;
      const deliveryLng = typeof body.deliveryLng === "number" ? body.deliveryLng : null;
      const deliveryAddress = typeof body.deliveryAddress === "string" && body.deliveryAddress.trim()
        ? body.deliveryAddress.trim()
        : null;
      const resolvedAt = new Date();

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          status: OrderStatus.PLACED,
          paymentStatus: PaymentStatus.PENDING,
          totalAmount,
          deliveryDate,
          deliveryLat: deliveryLat ?? undefined,
          deliveryLng: deliveryLng ?? undefined,
          deliveryAddress: deliveryAddress ?? undefined,

          items: {
            create: group.items.map((item) => ({
              productId: item.productId,
              supplierId: group.supplierId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              // REQ-06: the only price figure surfaced to the supplier —
              // the minimum of the canonical product's cross-supplier price
              // range at enquiry time (builder UI continues to show the
              // full min–max range; the actual order total/routing still
              // uses unitPrice above, unaffected by this addition).
              askPrice: item.askPrice ?? item.unitPrice,
              deliveryDate,
              canonicalProductId: item.canonicalProductId ?? undefined,
              resolvedListingId: item.resolvedListingId ?? undefined,
              tierMinQty: item.tierMinQty ?? undefined,
              tierMaxQty: item.tierMaxQty ?? undefined,
              priceAtResolution: item.resolvedListingId ? item.unitPrice : undefined,
              resolvedAt: item.resolvedListingId ? resolvedAt : undefined,
            })),

          },
          tracking: {
            create: {
              status: OrderStatus.PLACED,
              note: "Pending supplier confirmation",
            },
          },
        },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          items: {
            select: {
              id: true,
            },
          },
        },
      });

      createdOrders.push({
        id: order.id,
        supplierName: group.supplierName,
        total: totalAmount,
        itemCount: group.items.length,
        status: order.status,
      });
    }

    // Clear cart
    await prisma.cartItem.deleteMany({ where: { userId: user.id } });

    // Notify suppliers (best-effort, non-blocking) — WhatsApp notification for each new enquiry.
    for (const order of createdOrders) {
      void notifySupplierOrderSubmitted(order.id).catch((error) => {
        console.error(`Failed to send supplier notification for order ${order.id}:`, error);
      });
    }

    return NextResponse.json({ orders: createdOrders }, { status: 201 });

  } catch (error) {
    console.error("Orders POST error:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
