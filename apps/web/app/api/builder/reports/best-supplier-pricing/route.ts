import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getSupplierListings, parseListingPrice } from "@/lib/listings";
import type { BestSupplierPricingRow, SupplierPriceOption } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// Best Supplier Pricing: for canonical products the builder has ordered
// before, shows every currently active supplier's price for that same
// material side-by-side, flagging the cheapest. Uses the existing
// cross-supplier canonical-product grouping (CanonicalProduct.canonicalKey)
// plus the live public listings feed already used by the products/checkout
// flows — real, queryable data, no new model required.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const orderedProducts = await prisma.orderItem.findMany({
      where: { order: { userId: user.id } },
      select: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            canonicalProductId: true,
            canonicalProduct: { select: { canonicalKey: true, title: true } },
          },
        },
      },
    });

    // Only materials with a resolved canonical grouping can be compared
    // across suppliers; legacy/ungrouped products are skipped rather than
    // shown with a misleading single-supplier "comparison".
    const canonicalByKey = new Map<string, { title: string; unit: string }>();
    for (const item of orderedProducts) {
      const canonicalProduct = item.product.canonicalProduct;
      if (!canonicalProduct) continue;
      if (!canonicalByKey.has(canonicalProduct.canonicalKey)) {
        canonicalByKey.set(canonicalProduct.canonicalKey, {
          title: canonicalProduct.title,
          unit: item.product.unit,
        });
      }
    }

    if (canonicalByKey.size === 0) {
      return NextResponse.json([]);
    }

    const listings = await getSupplierListings();

    const rows: BestSupplierPricingRow[] = [];

    for (const [canonicalKey, meta] of canonicalByKey.entries()) {
      const matches = listings.filter(
        (listing) => listing.canonicalProductId === canonicalKey && listing.active
      );
      if (matches.length === 0) continue;

      const rawOptions = matches.map((listing) => ({
        supplierId: listing.supplierId,
        price: parseListingPrice(listing.price),
      }));

      const cheapestPrice = Math.min(...rawOptions.map((o) => o.price));
      const withCheapestFlag: SupplierPriceOption[] = rawOptions
        .map((option) => ({ ...option, isCheapest: option.price === cheapestPrice }))
        .sort((a, b) => a.price - b.price);

      rows.push({
        canonicalKey,
        name: meta.title,
        unit: meta.unit,
        options: withCheapestFlag,
      });
    }

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Best supplier pricing report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
