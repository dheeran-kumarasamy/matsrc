import { NextResponse } from "next/server";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  getOrCreateBuilder,
  resolveUserCtx,
} from "@/lib/builder-db";
import { getSupplierDisplayName } from "@/lib/supplier-display";
import { resolveMarkupForProduct } from "@matsrc/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            name: true,
            unit: true,
            supplierId: true,
            categoryId: true,
            basePrice: true,
            // C12 fix: the cart API never selected the product's `images`
            // field at all, so CartItem.image was always undefined
            // regardless of what the PLP/PDP had for the same product.
            // `images` (String[]) is the single canonical image store for
            // Product (packages/db/prisma/schema.prisma) — same field
            // ProductCard/ProductQuickView already read from — so this
            // reuses it rather than introducing a second image source.
            images: true,
            supplier: { select: { companyName: true } },
            pricingTiers: {
              select: { minQty: true, maxQty: true, tierPrice: true },
              orderBy: { minQty: "asc" },
            },
            aggregationEnabled: true,
            aggregationPriceTiers: true,
            aggregationWindowDays: true,
          },
        },

      },
      orderBy: { updatedAt: "desc" },
    });

    // Admin-Configurable Product Markup: the cart is a buyer-facing preview
    // of what checkout will charge — it must show the MARKED-UP price, not
    // the raw supplier price, so a buyer never sees a different (lower)
    // total in the cart than what createOrdersFromCart() actually charges
    // at checkout. Resolved per item (supplier price is the markup base,
    // never an already-marked-up value — see
    // packages/db/lib/markup-calculation.ts). Missing/disabled
    // configuration fails safe to 0% markup, mirroring every other
    // pricing call site's identical fallback.
    const itemsWithBuyerPrice = await Promise.all(
      items.map(async (item) => {
        const supplierUnitPrice =
          item.resolvedUnitPrice != null
            ? Number(item.resolvedUnitPrice)
            : resolveUnitPrice(item.product, item.quantity);

        const markup = await resolveMarkupForProduct(prisma as any, {
          productId: item.productId,
          categoryId: item.product.categoryId,
          supplierUnitPrice,
        }).catch(() => null);

        const unitPrice = markup ? markup.buyerUnitPrice : supplierUnitPrice;
        return { item, unitPrice };
      })
    );

    const subtotal = itemsWithBuyerPrice.reduce((acc, { unitPrice, item }) => acc + unitPrice * item.quantity, 0);

    return NextResponse.json({
      items: itemsWithBuyerPrice.map(({ item, unitPrice }) => {
        return {
          id: item.id,
          productId: item.productId,
          name: item.product.name,
          unit: item.product.unit,
          // C12 fix: surface the product's primary image (first entry of the
          // canonical `images` array, same convention ProductQuickView uses
          // — `images[0]`) so the cart UI has something to render. `null`
          // when the product genuinely has no images, so the client can
          // show its existing fallback instead of a broken <img>.
          image: item.product.images?.[0] ?? null,
          supplierId: item.resolvedSupplierId ?? item.product.supplierId,
          supplierName: getSupplierDisplayName(
            item.product.supplier.companyName,
            item.resolvedSupplierId ?? item.product.supplierId
          ),
          quantity: item.quantity,
          unitPrice,
          lineTotal: unitPrice * item.quantity,
          aggregationEnabled: item.product.aggregationEnabled,
          aggregationPriceTiers: item.product.aggregationPriceTiers,
          aggregationWindowDays: item.product.aggregationWindowDays,
        };
      }),

      summary: {
        itemCount: items.length,
        subtotal,
        subtotalLabel: formatCurrency(subtotal),
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Cart GET error:", error);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}
