// `find_suppliers` — controlled supplier-search tool (§6).
//
// Pure functions only: the caller (lib/sourcing/sourcing-data.ts) does the
// Prisma/listings-feed reads and hands the rows in. That keeps this module unit
// testable and, more importantly, means the LLM can never reach a query — it
// only ever receives the structured output of this function.
//
// EVERY returned field comes from real platform data:
//   basePrice           <- tier-resolved Product price (lib/resolution.ts)
//   serviceableQuantity <- Product.maxServiceableQty / stock
//   location            <- SupplierProfile.region
//   historicalRating    <- SupplierRating (delivery + quality mean)
//   verifiedBadge       <- SupplierProfile.verifiedBadge
//
// Fields the platform genuinely does not model are returned as null, NOT
// guessed:
//   - deliveryAvailable / estimatedDeliveryDays: there is no supplier
//     delivery-capability or lead-time model in this schema today (the only
//     lead-time data is SupplierQuote.leadTimeDays, which exists per QUOTE,
//     not per supplier). Unless a real quote lead time is supplied by the
//     caller these stay null, and the ranking engine records a data gap.
//   - minimumOrderQuantity: no MOQ column exists on Product/SupplierProfile.
//     Null until the schema models it.

import { effectiveTierForQuantity, type ResolutionCandidate } from "../resolution";
import { resolveState, type GeographyIndex } from "./geography";
import type {
  SourcingLocality,
  SourcingProductMatch,
  SourcingRequirement,
  SourcingSupplierCandidate,
} from "./types";

/**
 * A supplier listing row as handed to this tool. Mirrors the fields the
 * existing public listings feed / Product table already expose.
 */
export type SupplierListingRow = {
  /** Product.id */
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  /** SupplierProfile.region */
  supplierRegion: string | null;
  verifiedBadge: boolean;
  isActive: boolean;
  unit: string;
  brand: string | null;
  grade: string | null;
  basePrice: number | null;
  stock: number;
  maxServiceableQty: number | null;
  pricingTiers: Array<{ minQty: number; maxQty: number; tierPrice: number }>;
  /** Mean SupplierRating (0-5). Null when the supplier has never been rated. */
  historicalRating: number | null;
  /**
   * Lead time in days, ONLY when the caller has real evidence for it (e.g. an
   * existing SupplierQuote.leadTimeDays for this supplier/product). Never a
   * default.
   */
  leadTimeDays?: number | null;
};

export type FindSuppliersInput = {
  requirement: SourcingRequirement;
  /** Products the requirement matched (from search_products). */
  productMatches: SourcingProductMatch[];
  listings: SupplierListingRow[];
  /**
   * The platform's real district/state hierarchy, used only to classify
   * `locality` as STATE when a supplier's region is in the same state as the
   * requested location (e.g. "Tamilnadu" for a request to "Erode"). Optional
   * — omitting it simply means STATE is never assigned (falls back to
   * NON_LOCAL), never an error and never a change to LOCAL/UNKNOWN behaviour.
   */
  geography?: GeographyIndex;
};

/** Normalizes a name for comparison ("Erode " / "erode" -> "erode"). */
function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function availabilityOf(
  serviceable: number | null,
  requestedQuantity: number | null
): SourcingSupplierCandidate["availability"] {
  if (serviceable === null || serviceable <= 0) return "UNKNOWN";
  if (requestedQuantity === null) return "UNKNOWN";
  return serviceable >= requestedQuantity ? "IN_STOCK" : "PARTIAL";
}

/**
 * Classifies a supplier's locality relative to the requested delivery
 * location. DISCLOSURE ONLY — never used to exclude a candidate (§7/§8 of the
 * investigation, and the follow-up pricing-geography refinement). A supplier
 * with no region on file is UNKNOWN, never silently coerced into LOCAL
 * (which would misrepresent it as serviceable nearby) or NON_LOCAL (which
 * would misrepresent it as confirmed distant).
 *
 * Resolution order:
 *   1. LOCAL     — the free-text region textually matches the requested
 *                  location (same district/place; the original substring
 *                  match, unchanged).
 *   2. STATE     — not the same place, but the platform's real
 *                  PricingDistrict/PricingState hierarchy (`geography`, when
 *                  supplied) shows the supplier's region and the requested
 *                  location resolve to the SAME state — e.g. "Tamilnadu"
 *                  is applicable to a request for "Erode" because Erode is a
 *                  Tamil Nadu district. `geography` is optional so this
 *                  function stays usable (and its LOCAL/UNKNOWN behaviour
 *                  identical) anywhere the caller has not loaded it.
 *   3. NON_LOCAL — a region is on file but resolves to a different state (or
 *                  cannot be resolved against the requested location at all).
 *   4. UNKNOWN   — no region on file.
 */
export function classifyLocality(
  supplierRegion: string | null,
  requestedLocation: string | null,
  geography?: GeographyIndex
): SourcingLocality {
  const target = normalizeKey(requestedLocation);
  if (!target) return "UNKNOWN";

  const region = normalizeKey(supplierRegion);
  if (!region) return "UNKNOWN";

  if (region.includes(target) || target.includes(region)) return "LOCAL";

  if (geography) {
    const supplierState = resolveState(supplierRegion, geography);
    const requestedState = resolveState(requestedLocation, geography);
    if (supplierState && requestedState && supplierState === requestedState) {
      return "STATE";
    }
  }

  return "NON_LOCAL";
}

/**
 * `find_suppliers` tool implementation.
 *
 * Filters the given listings to the matched products, resolves each supplier's
 * effective unit price for the requested quantity using the EXISTING
 * cross-supplier tier-resolution helper, and returns one candidate per supplier
 * (that supplier's cheapest matching listing).
 */
export function findSuppliers({
  requirement,
  productMatches,
  listings,
  geography,
}: FindSuppliersInput): SourcingSupplierCandidate[] {
  if (productMatches.length === 0 || listings.length === 0) return [];

  const matchedProductIds = new Set(productMatches.map((match) => match.productId));
  const quantity = requirement.quantity ?? 1;
  const requestedBrand = normalizeKey(requirement.brand);

  const candidates: SourcingSupplierCandidate[] = [];

  for (const row of listings) {
    if (!row.isActive) continue; // inactive listings are never sourced from
    if (!matchedProductIds.has(row.productId)) continue;

    // Reuse the platform's own tier resolution so the assistant quotes exactly
    // the price the cart/checkout flow would.
    const resolutionCandidate: ResolutionCandidate = {
      listingId: row.productId,
      supplierId: row.supplierId,
      basePrice: row.basePrice ?? 0,
      stock: row.stock,
      maxServiceableQty: row.maxServiceableQty ?? 0,
      pricingTiers: row.pricingTiers,
      isActive: row.isActive,
    };

    const unitPrice =
      row.basePrice === null
        ? null
        : effectiveTierForQuantity(resolutionCandidate, quantity).tierPrice;

    const serviceable = row.maxServiceableQty ?? (row.stock > 0 ? row.stock : null);

    const specificationMatch =
      requestedBrand === "" ? true : normalizeKey(row.brand).includes(requestedBrand);

    const leadTimeDays =
      typeof row.leadTimeDays === "number" && Number.isFinite(row.leadTimeDays)
        ? row.leadTimeDays
        : null;

    candidates.push({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      location: row.supplierRegion,
      locality: classifyLocality(row.supplierRegion, requirement.location, geography),
      productId: row.productId,
      productName: row.productName,
      availability: availabilityOf(serviceable, requirement.quantity),
      serviceableQuantity: serviceable,
      basePrice: unitPrice,
      unit: row.unit,
      // No MOQ is modelled in the schema — null, never invented.
      minimumOrderQuantity: null,
      // No supplier delivery-capability model exists — null, never assumed.
      deliveryAvailable: null,
      estimatedDeliveryDays: leadTimeDays,
      historicalRating: row.historicalRating,
      reliabilityScore:
        row.historicalRating === null ? null : Math.round((row.historicalRating / 5) * 100),
      specificationMatch,
      verifiedBadge: row.verifiedBadge,
    });
  }

  // A supplier may carry several listings in the same canonical group; keep
  // each supplier's cheapest priced option. Mirrors the supplier-dedup rule in
  // lib/resolution.ts's rankCandidatesForQuantity.
  const bestBySupplier = new Map<string, SourcingSupplierCandidate>();
  for (const candidate of candidates) {
    const existing = bestBySupplier.get(candidate.supplierId);
    if (!existing) {
      bestBySupplier.set(candidate.supplierId, candidate);
      continue;
    }
    const existingPrice = existing.basePrice ?? Number.POSITIVE_INFINITY;
    const candidatePrice = candidate.basePrice ?? Number.POSITIVE_INFINITY;
    if (candidatePrice < existingPrice) {
      bestBySupplier.set(candidate.supplierId, candidate);
    }
  }

  return Array.from(bestBySupplier.values());
}

/**
 * Partitions candidates by whether the supplier's region matches the requested
 * delivery location.
 *
 * Deliberately does NOT drop out-of-region suppliers: this platform has no
 * serviceability/route model, so "different region" does not prove "cannot
 * deliver". The caller surfaces local options first and discloses that the
 * others are outside the requested area, rather than silently hiding real
 * suppliers or silently presenting distant ones as local.
 */
export function partitionByLocation(
  candidates: SourcingSupplierCandidate[],
  location: string | null
): { local: SourcingSupplierCandidate[]; other: SourcingSupplierCandidate[] } {
  const target = normalizeKey(location);
  if (!target) return { local: candidates, other: [] };

  const local: SourcingSupplierCandidate[] = [];
  const other: SourcingSupplierCandidate[] = [];

  for (const candidate of candidates) {
    const region = normalizeKey(candidate.location);
    if (region && (region.includes(target) || target.includes(region))) {
      local.push(candidate);
    } else {
      other.push(candidate);
    }
  }

  return { local, other };
}
