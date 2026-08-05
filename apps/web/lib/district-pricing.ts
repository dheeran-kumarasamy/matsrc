// Pure, DB-free helper functions for the District Price Intelligence panel
// (Phase 6A). Kept separate from the API route so the tricky bits (method
// labeling, freshness classification, market-position/diff math, source-tier
// labeling) are unit-testable without mocking Prisma — mirrors the existing
// lib/price-forecast.ts pattern.

import type {
  DistrictPriceMethodLabel,
  DistrictPricePanelSourceBreakdownEntry,
} from "@/lib/district-pricing-types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/// Maps the schema's granular PriceMethod enum to the human-facing badge
/// labels required by the spec (Observed / Derived / Derived + Freight /
/// Derived + DES Index) — MANUAL_OVERRIDE and DERIVED_BLENDED are additive,
/// not called out explicitly in the spec, so they get sensible labels too.
export function toMethodLabel(method: string): DistrictPriceMethodLabel {
  switch (method) {
    case "OBSERVED":
      return "Observed";
    case "DERIVED_FREIGHT":
      return "Derived + Freight";
    case "DERIVED_INDEX":
      return "Derived + DES Index";
    case "DERIVED_BLENDED":
      return "Derived + Freight"; // both adjustments; freight is the dominant customer-facing driver
    case "MANUAL_OVERRIDE":
      return "Manual Override";
    default:
      return "Derived";
  }
}

/// Freshness classification against a source's freshness SLA (hours). When
/// no SLA is known, falls back to a conservative 3-day default so a very
/// old price is never silently presented as current.
export function computeFreshness(
  priceDate: Date,
  now: Date,
  freshnessSlaHours: number | null
): { label: string; isStale: boolean } {
  const diffDays = Math.floor((now.getTime() - priceDate.getTime()) / MS_PER_DAY);
  const slaDays = freshnessSlaHours ? Math.ceil(freshnessSlaHours / 24) : 3;

  let label: string;
  if (diffDays <= 0) label = "Updated Today";
  else if (diffDays === 1) label = "Updated Yesterday";
  else label = `Updated ${diffDays} days ago`;

  return { label, isStale: diffDays > slaDays };
}

/// Below/Within/Above Market classification, computed once server-side and
/// never re-derived on the client. "Within" uses the P25-P75 band by default
/// when available (spec: "market band"), falling back to a fixed tolerance
/// band around the median when P25/P75 are absent (derived-only rows may
/// lack a spread).
export function computeMarketPosition(
  listingPricePerBaseUnit: number,
  medianPerBaseUnit: number,
  p25PerBaseUnit: number | null,
  p75PerBaseUnit: number | null
): { status: "BELOW" | "WITHIN" | "ABOVE"; diffPct: number } {
  const diffPct = medianPerBaseUnit > 0
    ? ((listingPricePerBaseUnit - medianPerBaseUnit) / medianPerBaseUnit) * 100
    : 0;

  const lowerBound = p25PerBaseUnit ?? medianPerBaseUnit * 0.95;
  const upperBound = p75PerBaseUnit ?? medianPerBaseUnit * 1.05;

  let status: "BELOW" | "WITHIN" | "ABOVE";
  if (listingPricePerBaseUnit < lowerBound) status = "BELOW";
  else if (listingPricePerBaseUnit > upperBound) status = "ABOVE";
  else status = "WITHIN";

  return { status, diffPct };
}

export function computeDiffPct(value: number, baseline: number): number | null {
  if (!baseline) return null;
  return ((value - baseline) / baseline) * 100;
}

const SOURCE_TIER_LABELS: Record<string, string> = {
  GOVERNMENT: "Government Sources",
  MANUFACTURER: "Manufacturer Sources",
  AGGREGATOR: "Aggregator Sources",
  MARKETPLACE: "Marketplace Sources",
  INTERNAL: "Internal (Matsrc) Sources",
};

export function tierLabel(tier: string): string {
  return SOURCE_TIER_LABELS[tier] ?? tier;
}

/// Builds the source-tier breakdown for the Price Explanation Card from a
/// list of contributing sources. Never includes INTERNAL_ONLY-licensed
/// sources' identity — callers must have already filtered those out before
/// calling this (enforced at the route layer against publicDisplayAllowed /
/// licenseClass), this function just groups+labels what it's given.
export function buildSourceBreakdown(
  sources: { tier: string; attributionText: string | null }[]
): DistrictPricePanelSourceBreakdownEntry[] {
  const byTier = new Map<string, { count: number; attributions: Set<string> }>();

  for (const source of sources) {
    const bucket = byTier.get(source.tier) ?? { count: 0, attributions: new Set<string>() };
    bucket.count += 1;
    if (source.attributionText) bucket.attributions.add(source.attributionText);
    byTier.set(source.tier, bucket);
  }

  return Array.from(byTier.entries())
    .map(([tier, bucket]) => ({
      tier: tier as DistrictPricePanelSourceBreakdownEntry["tier"],
      label: tierLabel(tier),
      sourceCount: bucket.count,
      attributionText: bucket.attributions.size > 0 ? Array.from(bucket.attributions).join("; ") : null,
    }))
    .sort((a, b) => b.sourceCount - a.sourceCount);
}
