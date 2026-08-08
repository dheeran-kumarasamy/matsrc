import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getSupplierListings, parseListingPrice } from "@/lib/listings";
import type { LiveMarketPriceRow, LiveMarketPriceOffer } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// Live Market Prices: for canonical products the builder has ordered before,
// shows every currently active supplier's price for that same material,
// sourced from the live public listings feed (same canonical-key scoping
// pattern as Best Supplier Pricing) — real, queryable data, no new model
// required. Supplier display names are resolved via a direct Prisma lookup
// since the public listings feed does not carry a supplier display name.
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
            unit: true,
            canonicalProductId: true,
            canonicalProduct: { select: { canonicalKey: true, title: true } },
          },
        },
      },
    });

    // NOTE: listings from the public feed carry `canonicalProductId` set to
    // the CanonicalProduct's cuid `id` (see
    // apps/supplier/lib/supplier-data.ts `getPublicSupplierListings()`), not
    // the composite `canonicalKey` string. Match against `product.id` here
    // (previously incorrectly matched against `canonicalKey`, which meant
    // this report's `matches` filter always returned zero rows).
    const canonicalById = new Map<string, { canonicalKey: string; title: string; unit: string }>();
    for (const item of orderedProducts) {
      const canonicalProduct = item.product.canonicalProduct;
      if (!canonicalProduct || !item.product.canonicalProductId) continue;
      if (!canonicalById.has(item.product.canonicalProductId)) {
        canonicalById.set(item.product.canonicalProductId, {
          canonicalKey: canonicalProduct.canonicalKey,
          title: canonicalProduct.title,
          unit: item.product.unit,
        });
      }
    }

    if (canonicalById.size === 0) {
      return NextResponse.json([]);
    }

    const listings = await getSupplierListings();

    const supplierIds = Array.from(new Set(listings.map((listing) => listing.supplierId)));
    const suppliers = supplierIds.length
      ? await prisma.supplierProfile.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, companyName: true },
        })
      : [];
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.companyName]));

    const rows: LiveMarketPriceRow[] = [];

    for (const [canonicalProductId, meta] of canonicalById.entries()) {
      const matches = listings.filter(
        (listing) => listing.canonicalProductId === canonicalProductId && listing.active
      );
      if (matches.length === 0) continue;

      const offers: LiveMarketPriceOffer[] = matches
        .map((listing) => ({
          supplierId: listing.supplierId,
          supplierName: supplierNameById.get(listing.supplierId) ?? listing.supplierId,
          price: parseListingPrice(listing.price),
        }))
        .sort((a, b) => a.price - b.price);

      const prices = offers.map((o) => o.price);

      rows.push({
        canonicalKey: meta.canonicalKey,
        name: meta.title,
        unit: meta.unit,
        offers,
        lowestPrice: Math.min(...prices),
        highestPrice: Math.max(...prices),
      });
    }

    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Live market prices report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
