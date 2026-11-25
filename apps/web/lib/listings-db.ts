import {
  calculateMarkup,
  isValidSupplierPrice,
  resolveEffectiveMarkupPercent,
} from "@matsrc/db";
import { ensureBuilderSchema, formatCurrency, prisma } from "@/lib/builder-db";
import type { ProductGroupResult, SupplierListing } from "@/lib/listings";

async function fetchMarkupRows(productIds: string[], categoryIds: string[]) {
  if (productIds.length === 0) return [];
  try {
    return await prisma.markupSetting.findMany({
      where: {
        isEnabled: true,
        OR: [
          { scope: "PRODUCT", scopeId: { in: productIds } },
          { scope: "CATEGORY", scopeId: { in: categoryIds } },
          { scope: "GLOBAL", scopeId: null },
        ],
      },
    });
  } catch {
    return [];
  }
}

async function transformDbProductsToListings(products: any[]): Promise<SupplierListing[]> {
  if (!products || products.length === 0) return [];

  const orderable = products.filter(
    (p: any) => p.isOrderable !== false && p.category?.isOrderable !== false
  );
  if (orderable.length === 0) return [];

  const distinctProductIds = Array.from(new Set(orderable.map((p: any) => p.id)));
  const distinctCategoryIds = Array.from(
    new Set(orderable.map((p: any) => p.categoryId).filter(Boolean))
  );
  const markupRows = await fetchMarkupRows(distinctProductIds, distinctCategoryIds);

  const toTier = (scope: string, scopeId: string | null) => {
    const row = markupRows.find((r: any) => r.scope === scope && r.scopeId === scopeId);
    return row ? { percentage: Number(row.percentage), isEnabled: row.isEnabled } : null;
  };
  const globalTier = toTier("GLOBAL", null);

  const resolveBuyerPrice = (productId: string, categoryId: string, supplierPrice: number): number => {
    const percent = resolveEffectiveMarkupPercent({
      product: toTier("PRODUCT", productId),
      category: toTier("CATEGORY", categoryId),
      global: globalTier,
    });
    if (percent === null || !isValidSupplierPrice(supplierPrice)) return supplierPrice;
    return calculateMarkup({ supplierUnitPrice: supplierPrice, markupPercent: percent }).buyerUnitPrice;
  };

  const mapped = orderable.map((product: any) => {
    const fallbackMaxQty = Number(product.maxServiceableQty ?? product.stock ?? 0);
    const rawTiers =
      Array.isArray(product.pricingTiers) && product.pricingTiers.length > 0
        ? product.pricingTiers
        : [{ minQty: 1, maxQty: fallbackMaxQty || 1, tierPrice: product.basePrice }];

    const markedUpTiers = rawTiers.map((tier: any) => ({
      minQty: Number(tier.minQty),
      maxQty: Number(tier.maxQty),
      tierPrice: resolveBuyerPrice(product.id, product.categoryId, Number(tier.tierPrice)),
    }));
    const buyerBasePrice = resolveBuyerPrice(product.id, product.categoryId, Number(product.basePrice));

    return {
      id: product.id,
      supplierId: product.supplierId,
      canonicalProductId: product.canonicalProductId ?? null,
      name: product.name,
      category: product.category?.name ?? "",
      brand: product.brandRef?.name ?? product.brand ?? "",
      grade: product.grade ?? "NA",
      sizeLabel: product.sizeLabel ?? null,
      unit: product.unit,
      price: `${formatCurrency(buyerBasePrice)} / ${product.unit}`,
      stock: `${product.stock} ${product.unit}`,
      maxServiceableQty: `${fallbackMaxQty} ${product.unit}`,
      active: Boolean(product.isActive),
      isOrderable: product.isOrderable !== false && product.category?.isOrderable !== false,
      categoryOrderable: product.category?.isOrderable !== false,
      updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : null,
      images: Array.isArray(product.images) ? product.images : [],
      pricingTiers: markedUpTiers.map((tier: any) => ({
        minQty: String(tier.minQty),
        maxQty: String(tier.maxQty),
        price: String(tier.tierPrice),
      })),
      _buyerBasePrice: buyerBasePrice,
      _tierPrices: markedUpTiers.map((t: any) => t.tierPrice),
    };
  });

  const groups = new Map<string, typeof mapped>();
  for (const item of mapped) {
    const key = item.canonicalProductId ?? item.id;
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  return mapped.map((listing) => {
    const key = listing.canonicalProductId ?? listing.id;
    const group = groups.get(key) ?? [listing];
    const groupedListingIds = group.map((g) => g.id);

    const sortedByBase = [...group].sort((a, b) => a._buyerBasePrice - b._buyerBasePrice);
    const headline = sortedByBase[0] ?? listing;

    const allTierPrices = group.flatMap((g) => g._tierPrices).filter((p) => Number.isFinite(p) && p > 0);
    const basePrices = group.map((g) => g._buyerBasePrice).filter((p) => Number.isFinite(p) && p > 0);

    const minPrice = basePrices.length > 0 ? Math.min(...basePrices) : null;
    const maxPrice = basePrices.length > 0 ? Math.max(...basePrices) : null;
    const startingPrice = allTierPrices.length > 0 ? Math.min(...allTierPrices) : minPrice;

    const groupImages =
      listing.images.length > 0
        ? listing.images
        : group.find((g) => g.images.length > 0)?.images ?? [];

    const { _buyerBasePrice, _tierPrices, ...publicFields } = listing;
    return {
      ...publicFields,
      images: groupImages,
      groupedListingIds,
      headlineSupplierId: headline.supplierId,
      headlinePrice: headline.price,
      minPrice,
      maxPrice,
      startingPrice,
    };
  });
}

export async function getPublicListingsFromDb(): Promise<SupplierListing[]> {
  await ensureBuilderSchema().catch(() => {});

  let products: any[] = [];
  try {
    products = await prisma.product.findMany({
      where: {
        isActive: true,
        isOrderable: true,
        category: { isOrderable: true },
      },
      include: {
        category: true,
        brandRef: true,
        pricingTiers: { orderBy: { minQty: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    try {
      products = await prisma.product.findMany({
        where: { isActive: true },
        include: { category: true, brandRef: true },
        orderBy: { updatedAt: "desc" },
      });
    } catch (err) {
      console.error("[listings-db] Failed to query products:", err);
      return [];
    }
  }

  return transformDbProductsToListings(products);
}

export async function getPublicProductGroupFromDb(slugOrId: string): Promise<ProductGroupResult | null> {
  await ensureBuilderSchema().catch(() => {});

  let target: any = null;
  try {
    target = await prisma.product.findFirst({
      where: {
        OR: [{ id: slugOrId }, { slug: slugOrId }],
        isActive: true,
      },
      select: { id: true, canonicalProductId: true },
    });
  } catch {
    return null;
  }

  if (!target) return null;

  let groupProducts: any[] = [];
  const whereClause = target.canonicalProductId
    ? { canonicalProductId: target.canonicalProductId, isActive: true }
    : { id: target.id, isActive: true };

  try {
    groupProducts = await prisma.product.findMany({
      where: whereClause,
      include: {
        category: true,
        brandRef: true,
        pricingTiers: { orderBy: { minQty: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    groupProducts = await prisma.product.findMany({
      where: whereClause,
      include: { category: true, brandRef: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  const transformed = await transformDbProductsToListings(groupProducts);
  if (transformed.length === 0) return null;

  const requested = transformed.find((l) => l.id === target.id) ?? transformed[0];
  const headline = requested.headlineSupplierId
    ? transformed.find((l) => l.supplierId === requested.headlineSupplierId) ?? requested
    : requested;

  return {
    displayListing: {
      ...headline,
      price: requested.headlinePrice || headline.price,
    },
    siblings: transformed,
  };
}
