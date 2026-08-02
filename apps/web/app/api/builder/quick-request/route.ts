import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getSupplierListings, type SupplierListing } from "@/lib/listings";
import { createOrdersFromCart } from "@/lib/order-checkout";
import {
  matchQuickRequest,
  type MatchableListing,
  type SupplierRatingLookup,
} from "@/lib/quick-request-matcher";

export const dynamic = "force-dynamic";

// FR-32: homepage "Quick Material Request" — nearest-match auto-enquiry.
//
// Auth: protected automatically by middleware.ts (same as every other
// /api/builder/* route) — getUserCtx() throws if the caller isn't a logged
// in session, which the surrounding try/catch turns into a 401 below,
// matching the existing pattern used across this app's builder routes.

function parseNumberLabel(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseQuantityLabel(value: string) {
  const numeric = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Mirrors apps/web/app/api/builder/cart/items/route.ts's ensureMarketplaceProduct
// — materializes a local Product row for a public listing that hasn't yet
// been mirrored locally, so a CartItem can reference it via the standard FK.
// Kept in this file (rather than shared) per existing project convention of
// small per-route duplicated helpers (see cart/items/route.ts vs orders/route.ts).
async function ensureMarketplaceProduct(listing: SupplierListing) {
  const supplierUser = await prisma.user.upsert({
    where: { email: "marketplace.supplier@buildmart.local" },
    update: { role: "SUPPLIER", name: "Verified Supplier" },
    create: {
      email: "marketplace.supplier@buildmart.local",
      name: "Verified Supplier",
      role: "SUPPLIER",
    },
  });

  const supplierProfile = await prisma.supplierProfile.upsert({
    where: { userId: supplierUser.id },
    update: { companyName: "Verified Supplier" },
    create: { userId: supplierUser.id, companyName: "Verified Supplier" },
  });

  const category = await prisma.category.upsert({
    where: { slug: slugify(listing.category) },
    update: { name: listing.category },
    create: { name: listing.category, slug: slugify(listing.category) },
  });

  return prisma.product.upsert({
    where: { id: listing.id },
    update: {
      name: listing.name,
      categoryId: category.id,
      grade: listing.grade,
      unit: listing.unit,
      basePrice: parseNumberLabel(listing.price),
      stock: parseQuantityLabel(listing.stock),
      maxServiceableQty: parseQuantityLabel(listing.stock) || undefined,
      isActive: listing.active,
      supplierId: supplierProfile.id,
      slug: `marketplace-${listing.id}`,
    },
    create: {
      id: listing.id,
      supplierId: supplierProfile.id,
      categoryId: category.id,
      name: listing.name,
      slug: `marketplace-${listing.id}`,
      grade: listing.grade,
      unit: listing.unit,
      basePrice: parseNumberLabel(listing.price),
      stock: parseQuantityLabel(listing.stock),
      maxServiceableQty: parseQuantityLabel(listing.stock) || null,
      images: [],
      isActive: listing.active,
    },
  });
}

function toMatchableListing(listing: SupplierListing): MatchableListing {
  return {
    id: listing.id,
    name: listing.name,
    category: listing.category,
    brand: listing.brand,
    grade: listing.grade,
    active: listing.active,
    canonicalProductId: listing.canonicalProductId ?? null,
    groupedListingIds: listing.groupedListingIds,
    headlineSupplierId: listing.headlineSupplierId,
    supplierId: listing.supplierId,
    updatedAt: listing.updatedAt ?? null,
    basePriceRaw: (listing as any).basePriceRaw,
    price: listing.price,
  };
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const body = await request.json().catch(() => ({}));
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    // `materialName` is still accepted for backward compatibility with the
    // old free-text nearest-match flow, but the current QuickRequestForm.tsx
    // now always submits an exact `productId` picked via Category/Brand/
    // Product dropdowns (admin-configured master data), not free text.
    const materialName = typeof body.materialName === "string" ? body.materialName.trim() : "";
    const quantityLabel = typeof body.quantity === "string" ? body.quantity : "";
    const parsedQuantity = parseQuantityLabel(quantityLabel);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;

    if (!productId && !materialName) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    console.log(
      `[quick-request] request received from user=${user.id} productId="${productId}" materialName="${materialName}" quantity=${quantity}`
    );

    // CRITICAL CACHING RULE: getSupplierListings() uses cache: "no-store" —
    // unchanged, do not touch. See apps/web/lib/listings.ts.
    const listings = await getSupplierListings();
    const matchable = listings.map(toMatchableListing);

    // Build a rating lookup (avg of deliveryRating + qualityRating per
    // supplier) used by the matcher's tie-break rule. Computed once up front
    // for all suppliers referenced by the fetched listings.
    const supplierIds = Array.from(
      new Set(
        matchable
          .map((listing) => listing.supplierId || listing.headlineSupplierId)
          .filter((id): id is string => Boolean(id))
      )
    );

    const ratingAggregates = supplierIds.length
      ? await prisma.supplierRating.groupBy({
          by: ["supplierId"],
          where: { supplierId: { in: supplierIds } },
          _avg: { deliveryRating: true, qualityRating: true },
        })
      : [];

    const ratingLookupMap = new Map<string, number>();
    for (const row of ratingAggregates) {
      const delivery = row._avg.deliveryRating ?? 0;
      const quality = row._avg.qualityRating ?? 0;
      ratingLookupMap.set(row.supplierId, (delivery + quality) / 2);
    }

    const getSupplierRating: SupplierRatingLookup = (supplierId) => ratingLookupMap.get(supplierId) ?? null;

    let matchResult: ReturnType<typeof matchQuickRequest>;

    if (productId) {
      // Exact product picked via dropdowns — skip the free-text fuzzy
      // matching stages entirely and treat the selected active listing as
      // the single winning group.
      const selectedMatchable = matchable.find((listing) => listing.id === productId && listing.active);

      if (!selectedMatchable) {
        console.log(
          `[quick-request] selected productId not found/active for user=${user.id} productId="${productId}"`
        );
        return NextResponse.json(
          {
            matched: false,
            message: "The selected product is no longer available — please choose another.",
          },
          { status: 200 }
        );
      }

      matchResult = {
        matched: true,
        stage: "exact",
        groups: [
          {
            canonicalKey: selectedMatchable.canonicalProductId || selectedMatchable.id,
            stage: "exact",
            candidates: [{ listing: selectedMatchable, score: 1 }],
            winner: selectedMatchable,
            tieBreakReason: "user-selected product",
          },
        ],
      };
    } else {
      matchResult = matchQuickRequest(materialName, matchable, getSupplierRating);
    }

    if (!matchResult.matched || matchResult.groups.length === 0) {
      console.log(`[quick-request] no-match fallback triggered for user=${user.id} materialName="${materialName}"`);
      return NextResponse.json(
        {
          matched: false,
          message: "We couldn't find a close match — browse categories or contact support.",
        },
        { status: 200 }
      );
    }

    // For each distinct matched canonical-product group, materialize/find the
    // winning listing's local Product row and add it to the builder's cart
    // at the requested quantity. This reuses the exact same CartItem shape
    // add-to-cart uses, so the shared createOrdersFromCart() pipeline below
    // (UF-03) groups/routes it identically to a normal cart checkout.
    for (const group of matchResult.groups) {
      const winnerListing = listings.find((listing) => listing.id === group.winner.id);
      if (!winnerListing) continue;

      let product = await prisma.product.findUnique({
        where: { id: winnerListing.id },
        select: { id: true, isActive: true },
      });

      if (!product || !product.isActive) {
        if (!winnerListing.active) continue; // never materialize/add an inactive listing
        const created = await ensureMarketplaceProduct(winnerListing);
        product = { id: created.id, isActive: created.isActive };
      }

      if (!product.isActive) continue;

      await prisma.cartItem.upsert({
        where: { userId_productId: { userId: user.id, productId: product.id } },
        update: { quantity },
        create: { userId: user.id, productId: product.id, quantity },
      });
    }

    // Submit through the SAME enquiry pipeline used by cart checkout (UF-03)
    // — no forked/duplicate enquiry path. This groups by resolved supplier
    // and creates one Order per supplier, exactly like manual checkout.
    const result = await createOrdersFromCart(user.id);

    if (!result.ok) {
      console.error(`[quick-request] order creation failed for user=${user.id}: ${result.error}`);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    console.log(
      `[quick-request] enquiry submitted for user=${user.id}, stage=${matchResult.stage}, orders created=${result.orders.length}`
    );

    return NextResponse.json(
      {
        matched: true,
        stage: matchResult.stage,
        orders: result.orders,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Quick request POST error:", error);
    return NextResponse.json({ error: "Failed to submit quick request" }, { status: 500 });
  }
}
