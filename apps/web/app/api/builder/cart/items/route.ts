import { NextResponse } from "next/server";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";
import {
  resolveLowestPriceForQuantity,
  type ResolutionCandidate,
} from "@/lib/resolution";

export const dynamic = "force-dynamic";

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

type SupplierListing = {
  id: string;
  name: string;
  category: string;
  grade: string;
  unit: string;
  price: string;
  stock: string;
  maxServiceableQty?: string;
  active: boolean;
  canonicalProductId?: string | null;
  groupedListingIds?: string[];
  headlinePrice?: string;
  headlineSupplierId?: string;
  // Additive raw-numeric fields exposed by getPublicSupplierListings() —
  // preferred source for building ResolutionCandidate objects since they
  // avoid re-parsing formatted currency/quantity strings.
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
    if (!response.ok) {
      return [];
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return [];
    }

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
 * Resolves, for a given listing's cross-supplier canonical group, which
 * specific listing currently offers the lowest price for `quantity` units —
 * per the "Product Discovery Duplicate Listings — Cross-Supplier Price
 * Resolution" spec's cart-add-time resolution step. Falls back to the
 * listing's own price if no canonical group / no other listings resolve.
 */
function resolveForListing(
  listing: SupplierListing,
  allListings: SupplierListing[],
  quantity: number
) {
  const groupIds = new Set(
    listing.groupedListingIds && listing.groupedListingIds.length > 0
      ? listing.groupedListingIds
      : listing.canonicalProductId
        ? allListings.filter((item) => item.canonicalProductId === listing.canonicalProductId).map((item) => item.id)
        : [listing.id]
  );

  const group = allListings.filter((item) => groupIds.has(item.id));
  const candidates = (group.length > 0 ? group : [listing]).map(toResolutionCandidate);

  return resolveLowestPriceForQuantity(candidates, quantity);
}

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
    where: { slug: listing.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") },
    update: { name: listing.category },
    create: {
      name: listing.category,
      slug: listing.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    },
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

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            name: true,
            unit: true,
            supplierId: true,
            basePrice: true,
            supplier: { select: { companyName: true } },
            pricingTiers: {
              select: { minQty: true, maxQty: true, tierPrice: true },
              orderBy: { minQty: "asc" },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const subtotal = items.reduce(
      (acc, item) =>
        acc +
        (item.resolvedUnitPrice != null
          ? Number(item.resolvedUnitPrice)
          : resolveUnitPrice(item.product, item.quantity)) *
          item.quantity,
      0
    );

    return NextResponse.json({
      items: items.map((item) => {
        const unitPrice =
          item.resolvedUnitPrice != null
            ? Number(item.resolvedUnitPrice)
            : resolveUnitPrice(item.product, item.quantity);

        return {
          id: item.id,
          productId: item.productId,
          name: item.product.name,
          unit: item.product.unit,
          supplierId: item.resolvedSupplierId ?? item.product.supplierId,
          supplierName: item.product.supplier.companyName,
          quantity: item.quantity,
          unitPrice,
          lineTotal: unitPrice * item.quantity,
        };
      }),
      summary: {
        itemCount: items.length,
        subtotal,
        subtotalLabel: formatCurrency(subtotal),
      },
    });
  } catch (error) {
    console.error("Cart items GET error:", error);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const productId = typeof body.productId === "string" ? body.productId : "";
    const quantity = Number(body.quantity);

    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "Valid productId and quantity are required" },
        { status: 400 }
      );
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true, canonicalProductId: true },
    });
    let resolvedProduct = product;

    // Fetch the full public supplier listings once — used both to bridge a
    // not-yet-mirrored marketplace product locally (existing behaviour) and
    // to perform cross-supplier canonical-group price resolution for the
    // added item (new behaviour, spec: resolve at add-to-cart time).
    const allListings = await fetchAllSupplierListings();

    if (!resolvedProduct || !resolvedProduct.isActive) {
      const listing = allListings.find((item) => item.id === productId) ?? null;
      if (!listing || !listing.active) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }

      const created = await ensureMarketplaceProduct(listing);
      resolvedProduct = {
        id: created.id,
        isActive: created.isActive,
        canonicalProductId: (created as any).canonicalProductId ?? listing.canonicalProductId ?? null,
      };
    }

    if (!resolvedProduct.isActive) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Cross-supplier price resolution: find the matching public listing (by
    // id) so we know its canonical group, then resolve the lowest-price
    // listing across that group for the requested quantity.
    const matchedListing = allListings.find((item) => item.id === productId);
    let resolution: ReturnType<typeof resolveForListing> | null = null;

    if (matchedListing) {
      resolution = resolveForListing(matchedListing, allListings, quantity);
    }

    const resolvedFields = resolution
      ? {
          resolvedListingId: resolution.listingId,
          resolvedSupplierId: resolution.supplierId || null,
          resolvedTierMinQty: resolution.tierMinQty,
          resolvedTierMaxQty: resolution.tierMaxQty,
          resolvedUnitPrice: resolution.unitPrice,
          resolvedAt: new Date(),
        }
      : {};

    const item = await prisma.cartItem.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      update: { quantity, ...resolvedFields },
      create: { userId: user.id, productId, quantity, ...resolvedFields },
    });

    return NextResponse.json({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      resolvedSupplierId: item.resolvedSupplierId,
      resolvedUnitPrice: item.resolvedUnitPrice != null ? Number(item.resolvedUnitPrice) : null,
    });
  } catch (error) {
    console.error("Cart items POST error:", error);
    return NextResponse.json(
      { error: "Failed to update cart" },
      { status: 500 }
    );
  }
}
