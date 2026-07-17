// Cross-supplier canonical product price-resolution engine.
//
// Background (spec: "Product Discovery Duplicate Listings — Cross-Supplier
// Price Resolution"): when two or more suppliers list what is functionally
// the same product (same admin-configured Category + Brand + Grade + Unit),
// Product.canonicalProductId groups them together (see
// packages/db/prisma/schema.prisma — CanonicalProduct model). This module
// contains the pure resolution logic used to:
//   1. Collapse a canonical group of listings into a single discovery card,
//      priced at the lowest available price for a given quantity.
//   2. Resolve the specific winning supplier listing for a builder's
//      selected quantity — used both when adding to cart and again at
//      checkout (re-resolution), so the enquiry is routed to whichever
//      supplier is actually cheapest for the tier the builder selected.
//
// This is intentionally framework/Prisma-agnostic (pure functions over
// plain data) so it can be unit tested and reused from any caller.

export type ResolutionPricingTier = {
  minQty: number;
  maxQty: number;
  tierPrice: number;
};

export type ResolutionCandidate = {
  listingId: string; // Product.id
  supplierId: string;
  basePrice: number;
  stock: number;
  maxServiceableQty: number;
  pricingTiers: ResolutionPricingTier[];
  isActive: boolean;
};

export type ResolutionResult = {
  listingId: string;
  supplierId: string;
  unitPrice: number;
  tierMinQty: number;
  tierMaxQty: number;
};

/**
 * Returns the tier (and effective unit price) that applies to `quantity` for
 * a single candidate listing, falling back to basePrice as a single implicit
 * "1..maxServiceableQty" tier when no explicit PricingTier rows exist.
 */
function effectiveTierForQuantity(candidate: ResolutionCandidate, quantity: number) {
  const tiers =
    candidate.pricingTiers.length > 0
      ? candidate.pricingTiers
      : [
          {
            minQty: 1,
            maxQty: candidate.maxServiceableQty || candidate.stock || quantity,
            tierPrice: candidate.basePrice,
          },
        ];

  const matched = tiers.find((tier) => quantity >= tier.minQty && quantity <= tier.maxQty);
  if (matched) return matched;

  // Quantity exceeds every defined tier band — fall back to the highest
  // (last) tier rather than refusing to resolve, so large orders still get
  // a price rather than silently failing.
  return tiers[tiers.length - 1];
}

/**
 * Core resolution algorithm (spec section "Price Resolution Algorithm"):
 * for the given quantity, find the candidate listing offering the lowest
 * effective unit price. Tie-break order: higher stock/maxServiceableQty
 * first (more likely to actually fulfil), then listingId ascending
 * (deterministic, stable ordering).
 *
 * Only `isActive` candidates participate. Returns null if there are no
 * eligible candidates.
 */
export function resolveLowestPriceForQuantity(
  candidates: ResolutionCandidate[],
  quantity: number
): ResolutionResult | null {
  const eligible = candidates.filter((candidate) => candidate.isActive);
  if (eligible.length === 0) return null;

  let winner: { candidate: ResolutionCandidate; tier: ResolutionPricingTier } | null = null;

  for (const candidate of eligible) {
    const tier = effectiveTierForQuantity(candidate, quantity);

    if (!winner) {
      winner = { candidate, tier };
      continue;
    }

    if (tier.tierPrice < winner.tier.tierPrice) {
      winner = { candidate, tier };
      continue;
    }

    if (tier.tierPrice === winner.tier.tierPrice) {
      const winnerServiceable = winner.candidate.maxServiceableQty || winner.candidate.stock;
      const candidateServiceable = candidate.maxServiceableQty || candidate.stock;

      if (candidateServiceable > winnerServiceable) {
        winner = { candidate, tier };
        continue;
      }

      if (candidateServiceable === winnerServiceable && candidate.listingId < winner.candidate.listingId) {
        winner = { candidate, tier };
      }
    }
  }

  if (!winner) return null;

  return {
    listingId: winner.candidate.listingId,
    supplierId: winner.candidate.supplierId,
    unitPrice: winner.tier.tierPrice,
    tierMinQty: winner.tier.minQty,
    tierMaxQty: winner.tier.maxQty,
  };
}

/**
 * Lowest "headline" price for a canonical group, used to price the merged
 * discovery card (spec: "the builder should see one product card, priced at
 * the lowest available price"). Uses quantity=1 so the badge reflects the
 * best entry-level price across all candidate suppliers.
 */
export function resolveHeadlinePrice(candidates: ResolutionCandidate[]): ResolutionResult | null {
  return resolveLowestPriceForQuantity(candidates, 1);
}

export type PriceRange = {
  minPrice: number;
  maxPrice: number;
};

/**
 * Computes the min–max price range across a canonical group of listings
 * (spec: REQ-02 "discovery should show one consolidated card per canonical
 * id with min–max price range across active listings"). Uses each active
 * candidate's quantity=1 effective unit price (the same basis as
 * resolveHeadlinePrice) so the range is directly comparable to the headline
 * price. Returns null if there are no eligible (active) candidates.
 */
export function resolvePriceRange(candidates: ResolutionCandidate[]): PriceRange | null {
  const eligible = candidates.filter((candidate) => candidate.isActive);
  if (eligible.length === 0) return null;

  const unitPrices = eligible.map((candidate) => effectiveTierForQuantity(candidate, 1).tierPrice);

  return {
    minPrice: Math.min(...unitPrices),
    maxPrice: Math.max(...unitPrices),
  };
}


export type GroupKeyedListing<T> = T & { canonicalProductId: string | null; id: string };

/**
 * Groups a flat list of listings by canonicalProductId. Listings with a
 * null canonicalProductId (not yet backfilled / genuinely unique products)
 * are kept as their own single-item group keyed by their own id, so they
 * continue to behave exactly as before (spec: backward compatibility).
 */
export function groupByCanonicalProduct<T>(
  listings: GroupKeyedListing<T>[]
): Map<string, GroupKeyedListing<T>[]> {
  const groups = new Map<string, GroupKeyedListing<T>[]>();

  for (const listing of listings) {
    const key = listing.canonicalProductId ?? listing.id;
    const existing = groups.get(key);
    if (existing) {
      existing.push(listing);
    } else {
      groups.set(key, [listing]);
    }
  }

  return groups;
}
