import * as React from "react";

// In Next.js Server Components, React.cache memoizes requests across the render tree.
// In test/client environments where React.cache is not defined, falls back to direct execution.
const requestCache: <T extends (...args: any[]) => any>(fn: T) => T =
  typeof (React as any).cache === "function" ? (React as any).cache : (fn: any) => fn;

// Shared fetch/parsing helpers for supplier listings, used by:
// - the full PLP page (app/(builder)/products/page.tsx)
// - the full standalone PDP page (app/(builder)/products/[slug]/page.tsx)
// - the intercepted quick-view overlay (app/(builder)/@modal/(.)products/[slug]/page.tsx)
//
// Centralizing this avoids drift between the "full page" and "overlay" render
// paths, which must show identical data per spec section 5A.

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://supplier.buildohub.in";

export type PricingTier = {
  minQty: string;
  maxQty: string;
  price: string;
};

export type SupplierListing = {
  id: string;
  supplierId: string;
  name: string;
  category: string;
  // BUG-01 fix: real brand value (Brand master-data name, falling back to
  // legacy free-text brand column) sourced from
  // apps/supplier/lib/supplier-data.ts `getPublicSupplierListings()`.
  brand?: string;
  grade: string;
  // Physical size/diameter spec (e.g. "8mm") — null/absent when the
  // product has no distinct size. See apps/supplier/lib/supplier-data.ts
  // `getPublicSupplierListings()` / the CanonicalProduct grouping fix this
  // field was added for.
  sizeLabel?: string | null;
  unit: string;
  price: string;
  stock: string;
  maxServiceableQty: string;
  active: boolean;
  isOrderable?: boolean;
  categoryOrderable?: boolean;
  pricingTiers: PricingTier[];
  images?: string[];
  // BUG-04 fix: ISO timestamp used to power the "Newest" sort option.
  updatedAt?: string | null;

  // Cross-supplier canonical-product resolution fields (additive). Present
  // when the listing's Category/Brand/Grade/Unit match another supplier's
  // listing exactly (per admin-configured master data) — see
  // apps/supplier/lib/supplier-data.ts `getPublicSupplierListings()`.
  canonicalProductId?: string | null;
  groupedListingIds?: string[];
  headlinePrice?: string;
  headlineSupplierId?: string;
  // Min–max price range (raw numeric) across the canonical group's active
  // listings (REQ-02) — see apps/supplier/lib/supplier-data.ts
  // `getPublicSupplierListings()` / `resolvePriceRange()`. Null when
  // unresolvable (no active candidates in the group).
  minPrice?: number | null;
  maxPrice?: number | null;
  // PLP "Starting from ₹Xxx" display price (product-listing price display
  // change) — the true minimum valid price across ALL suppliers in the
  // canonical group AND ALL of their price tiers (not just each supplier's
  // quantity=1 tier, unlike minPrice/maxPrice above) — see
  // apps/supplier/lib/supplier-data.ts `getPublicSupplierListings()` /
  // `resolveMinimumDisplayPrice()`. Null when unresolvable (no active
  // candidates with a valid price).
  startingPrice?: number | null;
  supplierCount?: number;
};

export type ProductGroupResult = {
  displayListing: SupplierListing;
  siblings: SupplierListing[];
};

export const getSupplierListings = requestCache(async (): Promise<SupplierListing[]> => {
  try {
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings`, {
      next: { revalidate: 300, tags: ["catalog-listings"] },
      redirect: "manual",
    });

    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return [];

    return response.json() as Promise<SupplierListing[]>;
  } catch {
    return [];
  }
});

export const getSupplierProductGroup = requestCache(async (slug: string): Promise<ProductGroupResult | null> => {
  let shouldFallback = false;
  try {
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300, tags: ["catalog-listings", `product-${slug}`] },
      redirect: "manual",
    });

    // Genuine 404: product does not exist. Return null immediately without expensive full-catalogue fallback.
    if (response.status === 404) {
      return null;
    }

    if (response.ok) {
      const data = await response.json();
      if (data && data.displayListing) {
        return data as ProductGroupResult;
      }
      return null;
    }

    // Only 5xx server errors warrant fallback to cached full catalogue
    if (response.status >= 500) {
      shouldFallback = true;
    } else {
      return null;
    }
  } catch {
    // Network failures or offline errors may attempt fallback to cached full catalogue
    shouldFallback = true;
  }

  if (!shouldFallback) {
    return null;
  }

  const allListings = await getSupplierListings();
  const requested = allListings.find((listing) => listing.id === slug);
  if (!requested) return null;

  const groupedIds = requested.groupedListingIds && requested.groupedListingIds.length > 0
    ? requested.groupedListingIds
    : [requested.id];

  const siblings = allListings.filter((listing) => groupedIds.includes(listing.id));
  const headline = requested.headlineSupplierId
    ? siblings.find((listing) => listing.supplierId === requested.headlineSupplierId) ?? requested
    : requested;

  return {
    displayListing: {
      ...headline,
      price: requested.headlinePrice || headline.price,
    },
    siblings,
  };
});

export const getSupplierProduct = requestCache(async (slug: string): Promise<SupplierListing | null> => {
  const group = await getSupplierProductGroup(slug);
  return group?.displayListing ?? null;
});

export function parseNumericLabel(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function parseListingPrice(value: string) {
  return parseNumericLabel(value);
}

function normalizeListingText(val?: string | null): string {
  return (val || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeListingUnit(unit?: string | null): string {
  return normalizeListingText(unit).replace(/s$/, "");
}

function normalizeListingBrand(brand?: string | null, name?: string | null): string {
  const b = normalizeListingText(brand);
  const n = normalizeListingText(name);
  if (b === "vizag" || b === "vizag steel" || n.includes("vizag steel")) {
    return "vizag steel";
  }
  return b;
}

export function getProductDetailKey(listing: {
  name?: string;
  category?: string;
  unit?: string;
  grade?: string;
  sizeLabel?: string | null;
  brand?: string;
}): string {
  const name = normalizeListingText(listing.name);
  const category = normalizeListingText(listing.category);
  const unit = normalizeListingUnit(listing.unit);
  const brand = normalizeListingBrand(listing.brand, listing.name);
  const grade = normalizeListingText(listing.grade).replace(/[-_\s]/g, "");
  const size = normalizeListingText(listing.sizeLabel).replace(/[-_\s]/g, "");

  return `${category}::${brand}::${name}::${unit}::${grade}::${size}`;
}

// Collapses a full listings array down to one representative "headline" card
// per canonical product group — combines SKUs based on canonicalProductId
// as well as matching product details (name, category, unit, grade, size, brand),
// even if prices or supplier pricing tiers are different.
//
// The representative listing shown is the one offering the lowest valid price
// across the group, with its headline/starting price reflecting the group's
// minimum. All sibling listing IDs and unique suppliers are preserved.
export function dedupeByCanonicalGroup(listings: SupplierListing[]): SupplierListing[] {
  if (!listings || listings.length === 0) return [];

  const parent: number[] = listings.map((_, i) => i);

  function find(i: number): number {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  }

  function union(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  }

  const keyToFirstIndex = new Map<string, number>();

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    const keys: string[] = [];

    if (listing.canonicalProductId && listing.canonicalProductId.trim() !== "") {
      keys.push(`canon:${listing.canonicalProductId.trim()}`);
    }

    const detailKey = getProductDetailKey(listing);
    if (detailKey) {
      keys.push(`detail:${detailKey}`);
    }

    for (const k of keys) {
      if (keyToFirstIndex.has(k)) {
        union(i, keyToFirstIndex.get(k)!);
      } else {
        keyToFirstIndex.set(k, i);
      }
    }
  }

  const clusters = new Map<number, SupplierListing[]>();
  for (let i = 0; i < listings.length; i++) {
    const root = find(i);
    const existing = clusters.get(root);
    if (existing) {
      existing.push(listings[i]);
    } else {
      clusters.set(root, [listings[i]]);
    }
  }

  const result: SupplierListing[] = [];

  for (const group of clusters.values()) {
    if (group.length === 0) continue;

    // Collect all unique grouped IDs across the group
    const groupedIds = Array.from(
      new Set(
        group.flatMap((l) =>
          l.groupedListingIds && l.groupedListingIds.length > 0 ? l.groupedListingIds : [l.id]
        )
      )
    );

    // Collect all valid starting prices and prices to find the lowest display price
    const validStartingPrices = group
      .map((l) => l.startingPrice)
      .filter((p): p is number => typeof p === "number" && !isNaN(p) && p > 0);
    const minStartingPrice = validStartingPrices.length > 0 ? Math.min(...validStartingPrices) : undefined;

    const validMinPrices = group
      .map((l) =>
        typeof l.minPrice === "number" && !isNaN(l.minPrice) && l.minPrice > 0
          ? l.minPrice
          : parseListingPrice(l.price)
      )
      .filter((p): p is number => typeof p === "number" && !isNaN(p) && p > 0);
    const minPrice = validMinPrices.length > 0 ? Math.min(...validMinPrices) : undefined;

    const validMaxPrices = group
      .map((l) =>
        typeof l.maxPrice === "number" && !isNaN(l.maxPrice) && l.maxPrice > 0
          ? l.maxPrice
          : parseListingPrice(l.price)
      )
      .filter((p): p is number => typeof p === "number" && !isNaN(p) && p > 0);
    const maxPrice = validMaxPrices.length > 0 ? Math.max(...validMaxPrices) : undefined;

    // Find the best representative listing: lowest effective price, has images, newest
    const sortedCandidates = [...group].sort((a, b) => {
      const priceA = a.startingPrice ?? a.minPrice ?? parseListingPrice(a.price);
      const priceB = b.startingPrice ?? b.minPrice ?? parseListingPrice(b.price);
      if (priceA !== priceB) return priceA - priceB;
      const imgA = a.images && a.images.length > 0 ? 0 : 1;
      const imgB = b.images && b.images.length > 0 ? 0 : 1;
      if (imgA !== imgB) return imgA - imgB;
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return timeB - timeA;
    });

    const representative = sortedCandidates[0];

    // Effective headline price string
    const lowestPrice = minStartingPrice ?? minPrice ?? parseListingPrice(representative.price);
    const headlinePrice =
      representative.unit && lowestPrice > 0
        ? `₹${lowestPrice} / ${representative.unit}`
        : representative.headlinePrice || representative.price;

    // Images: prefer representative's images, fallback to any group member with images
    const images =
      representative.images && representative.images.length > 0
        ? representative.images
        : group.find((l) => l.images && l.images.length > 0)?.images || [];

    const uniqueSuppliers = new Set(group.map((l) => l.supplierId));

    result.push({
      ...representative,
      price: headlinePrice,
      startingPrice: minStartingPrice ?? representative.startingPrice,
      minPrice: minPrice ?? representative.minPrice,
      maxPrice: maxPrice ?? representative.maxPrice,
      images,
      groupedListingIds: groupedIds,
      supplierCount: uniqueSuppliers.size,
    });
  }

  return result;
}

