// Cross-supplier canonical product price-resolution engine.
//
// Duplicated from apps/supplier/lib/resolution.ts (pure functions, no
// Prisma/framework dependency) — apps/web cannot import directly from
// another Next.js app's `lib/` folder in this monorepo (no shared package
// export configured for it), so per existing project convention of small
// duplicated per-app helpers (see also the `useCatalogOptions` hook
// duplicated across ListingForm.tsx and ProductFilters.tsx), this module is
// kept in sync with the supplier-side copy.
//
// Used by apps/web's cart-add (`/api/builder/cart/items` POST) and
// checkout/order (`/api/builder/orders` POST) route handlers to resolve,
// for a canonical group of cross-supplier listings, which specific listing
// currently offers the lowest price for the quantity the builder selected —
// re-resolved fresh at both add-to-cart time and checkout time per spec.

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

export function effectiveTierForQuantity(candidate: ResolutionCandidate, quantity: number) {

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

  return tiers[tiers.length - 1];
}

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

export function resolveHeadlinePrice(candidates: ResolutionCandidate[]): ResolutionResult | null {
  return resolveLowestPriceForQuantity(candidates, 1);
}

// Multi-supplier fan-out (see packages/db/prisma/schema.prisma
// OrderItemSupplierCandidate): ranks every active candidate lowest-price
// first for the requested quantity, so an enquiry line item can be created
// with the FULL pool of eligible suppliers, not just the single winner.
// When the top-ranked (currently-assigned) supplier declines, the next
// candidate in this ranking is promoted instead of cancelling the whole
// enquiry — the enquiry is only cancelled once every ranked candidate has
// declined.
//
// IMPORTANT: OrderItemSupplierCandidate has a UNIQUE constraint on
// (orderItemId, supplierId) — a supplier can only appear once per order
// item's candidate pool. A single supplier may have multiple active
// listings within the same canonical product group (e.g. two SKUs that
// both map to the same canonical product), so results must be deduplicated
// by supplierId here (keeping each supplier's best-ranked/lowest-price
// listing only) — otherwise callers that persist every ranked entry as its
// own row (see apps/web/lib/order-checkout.ts) would attempt to insert two
// rows with the same (orderItemId, supplierId) and violate that
// constraint, causing checkout to fail with a 500 (Prisma error P2002).
export function rankCandidatesForQuantity(
  candidates: ResolutionCandidate[],
  quantity: number
): ResolutionResult[] {
  const eligible = candidates.filter((candidate) => candidate.isActive);

  const ranked = eligible
    .map((candidate) => {
      const tier = effectiveTierForQuantity(candidate, quantity);
      return {
        listingId: candidate.listingId,
        supplierId: candidate.supplierId,
        unitPrice: tier.tierPrice,
        tierMinQty: tier.minQty,
        tierMaxQty: tier.maxQty,
        serviceable: candidate.maxServiceableQty || candidate.stock,
      };
    })
    .sort((a, b) => {
      if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
      if (a.serviceable !== b.serviceable) return b.serviceable - a.serviceable;
      return a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0;
    });

  const seenSuppliers = new Set<string>();
  const dedupedBySupplier = ranked.filter((entry) => {
    if (seenSuppliers.has(entry.supplierId)) return false;
    seenSuppliers.add(entry.supplierId);
    return true;
  });

  return dedupedBySupplier.map(({ listingId, supplierId, unitPrice, tierMinQty, tierMaxQty }) => ({
    listingId,
    supplierId,
    unitPrice,
    tierMinQty,
    tierMaxQty,
  }));
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
