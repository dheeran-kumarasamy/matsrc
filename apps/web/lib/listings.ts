// Shared fetch/parsing helpers for supplier listings, used by:
// - the full PLP page (app/(builder)/products/page.tsx)
// - the full standalone PDP page (app/(builder)/products/[slug]/page.tsx)
// - the intercepted quick-view overlay (app/(builder)/@modal/(.)products/[slug]/page.tsx)
//
// Centralizing this avoids drift between the "full page" and "overlay" render
// paths, which must show identical data per spec section 5A.

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

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
  grade: string;
  unit: string;
  price: string;
  stock: string;
  maxServiceableQty: string;
  active: boolean;
  pricingTiers: PricingTier[];
  images?: string[];
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
};



export async function getSupplierListings(): Promise<SupplierListing[]> {
  try {
    // CRITICAL CACHING RULE: no-store so newly active SKUs show immediately.
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings`, {
      cache: "no-store",
      redirect: "manual",
    });

    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return [];

    return response.json() as Promise<SupplierListing[]>;
  } catch {
    return [];
  }
}

export async function getSupplierProduct(slug: string): Promise<SupplierListing | null> {
  const listings = await getSupplierListings();
  return listings.find((listing) => listing.id === slug) ?? null;
}

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

