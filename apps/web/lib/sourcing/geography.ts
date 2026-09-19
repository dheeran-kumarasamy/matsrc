// Pricing/location geography resolution for the sourcing assistant.
//
// TWO DISTINCT CONCEPTS, kept separate throughout this module (per the
// business investigation): a supplier's PHYSICAL location/service area
// (SupplierProfile.region — free text, e.g. "Erode", "Tamilnadu") vs the
// platform's REAL geographic hierarchy (PricingDistrict -> PricingState,
// e.g. "Erode" district belongs to "Tamil Nadu" state). SupplierProfile.region
// has never been normalized against PricingDistrict/PricingState, so a
// supplier's free-text region is matched against this hierarchy on a
// best-effort basis — it never fabricates a relationship that isn't
// supported by the actual district/state data loaded from the database.
//
// This module is PURE (no Prisma) so it stays unit-testable like the rest of
// lib/sourcing/*; the Prisma read lives in sourcing-data.ts's
// loadGeographyIndex().

import type { SourcingLocality } from "./types";

/** Tight normalization: lowercase, trimmed, AND whitespace-stripped.
 *
 * Real data has both "Tamil Nadu" (PricingState.name, canonical, spaced) and
 * "Tamilnadu" (SupplierProfile.region, free text, unspaced) referring to the
 * same state — a plain lowercase/trim compare would treat them as different
 * strings. Stripping whitespace is safe for Indian state/district names
 * (none rely on a space to disambiguate from another name) and is scoped to
 * this module only; it never changes the loose district-level substring
 * match used for LOCAL, which is preserved as before.
 */
function tight(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function loose(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * A resolved index of the platform's real geography (PricingDistrict ->
 * PricingState), keyed by every name/code a free-text supplier region might
 * plausibly use. Built once per sourcing turn from loadGeographyIndex() and
 * passed through as plain data — never re-queried per candidate.
 */
export type GeographyIndex = {
  /** tight(name-or-code) -> canonical state name, e.g. "erode" -> "Tamil Nadu". */
  stateOfLocation: Map<string, string>;
};

export type DistrictRow = { name: string; stateName: string };
export type StateRow = { name: string; code: string };

/** Builds a GeographyIndex from raw PricingDistrict/PricingState rows. Pure. */
export function buildGeographyIndex(districts: DistrictRow[], states: StateRow[]): GeographyIndex {
  const stateOfLocation = new Map<string, string>();

  for (const state of states) {
    stateOfLocation.set(tight(state.name), state.name);
    stateOfLocation.set(tight(state.code), state.name);
  }
  for (const district of districts) {
    stateOfLocation.set(tight(district.name), district.stateName);
  }

  return { stateOfLocation };
}

/** Resolves any location/region name to its canonical state, when known. */
export function resolveState(name: string | null, geography: GeographyIndex): string | null {
  return geography.stateOfLocation.get(tight(name)) ?? null;
}
