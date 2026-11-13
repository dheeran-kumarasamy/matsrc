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

// Collapses a full listings array down to one representative "headline" card
// per canonical product group — fixes the Display bug from the cross-supplier
// price resolution spec (duplicate cards for the same product from different
// suppliers). Groups are keyed by canonicalProductId when present (exact
// admin-configured Category/Brand/Grade/Unit match); listings without a
// canonicalProductId (legacy / ungrouped data) fall back to being their own
// singleton group keyed by their own id, preserving backward compatibility.
//
// The representative listing shown is the one matching headlineSupplierId
// (the lowest-priced supplier for the group), with its own `price` field
// overridden to the group's `headlinePrice` for display. All sibling listing
// ids are preserved on `groupedListingIds` so PDP/quick-view can still surface
// per-supplier tier detail if needed.
export function dedupeByCanonicalGroup(listings: SupplierListing[]): SupplierListing[] {
  const seenGroupKeys = new Set<string>();
  const result: SupplierListing[] = [];

  for (const listing of listings) {
    const groupKey = listing.canonicalProductId || listing.id;
    if (seenGroupKeys.has(groupKey)) continue;
    seenGroupKeys.add(groupKey);

    const groupedIds = listing.groupedListingIds && listing.groupedListingIds.length > 0
      ? listing.groupedListingIds
      : [listing.id];

    let representative = listing;
    if (listing.headlineSupplierId && listing.headlineSupplierId !== listing.supplierId) {
      const headlineListing = listings.find(
        (candidate) => candidate.supplierId === listing.headlineSupplierId && groupedIds.includes(candidate.id)
      );
      if (headlineListing) representative = headlineListing;
    }

    result.push({
      ...representative,
      price: listing.headlinePrice || representative.price,
      groupedListingIds: groupedIds,
    });
  }

  return result;
}

