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
