import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// P0 price-discovery: cross-supplier comparison endpoint for a canonical
// SKU. Builder-only read. Local Next.js route handler (direct-Prisma),
// mirroring the existing pattern used by watchlist/orders/cart in this app
// rather than proxying to the separate NestJS apps/api.
//
// Returns:
//  - offers: all currently ACTIVE Product listings sharing this
//    canonicalProductId, across all suppliers (live cross-supplier view).
//  - history: raw PriceSnapshot rows for this canonicalProductId, newest
//    first (capped at 90 rows). No aggregation/median/percentile computed
//    here — that is explicitly out of scope for this endpoint (P0).
//
// This does NOT touch/replace the public listings read path
// (apps/supplier/app/api/public/listings/route.ts) — it reads directly
// from Prisma against the CanonicalProduct/Product/PriceSnapshot tables.
export async function GET(request: Request, { params }: { params: { canonicalProductId: string } }) {
  try {
    const ctx = getUserCtx(request);
    await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const { canonicalProductId } = params;
    if (!canonicalProductId) {
      return NextResponse.json({ error: "canonicalProductId is required" }, { status: 400 });
    }

    const canonicalProduct = await prisma.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
    });
    if (!canonicalProduct) {
      return NextResponse.json({ error: "Canonical product not found" }, { status: 404 });
    }

    const [offers, history] = await Promise.all([
      prisma.product.findMany({
        where: { canonicalProductId, isActive: true },
        select: {
          id: true,
          name: true,
          brand: true,
          basePrice: true,
          unit: true,
          supplierId: true,
          supplier: { select: { companyName: true } },
          brandRef: { select: { name: true } },
          pricingTiers: {
            select: { minQty: true, maxQty: true, tierPrice: true },
            orderBy: { minQty: "asc" },
          },
        },
        orderBy: { basePrice: "asc" },
      }),
      prisma.priceSnapshot.findMany({
        where: { canonicalProductId },
        orderBy: { capturedAt: "desc" },
        take: 90,
        select: {
          id: true,
          price: true,
          source: true,
          unit: true,
          region: true,
          capturedAt: true,
          supplierId: true,
        },
      }),
    ]);

    return NextResponse.json({
      canonicalProductId,
      title: canonicalProduct.title,
      offers: offers.map((offer) => ({
        productId: offer.id,
        name: offer.name,
        brand: offer.brandRef?.name ?? offer.brand ?? null,
        supplierId: offer.supplierId,
        supplierName: offer.supplier.companyName,
        price: Number(offer.basePrice),
        unit: offer.unit,
        pricingTiers: offer.pricingTiers.map((tier) => ({
          minQty: tier.minQty,
          maxQty: tier.maxQty,
          tierPrice: Number(tier.tierPrice),
        })),
      })),
      history: history.map((snapshot) => ({
        id: snapshot.id,
        price: Number(snapshot.price),
        source: snapshot.source,
        unit: snapshot.unit,
        region: snapshot.region,
        recordedAt: snapshot.capturedAt,
        supplierId: snapshot.supplierId,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Price comparison GET error:", error);
    return NextResponse.json({ error: "Failed to fetch price comparison" }, { status: 500 });
  }
}
