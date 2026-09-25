// THE single authoritative site/location matching service (§24 of the
// location-aware site selection change).
//
// Every caller — the sourcing turn (`message`) route, the session GET route,
// and (indirectly, via the server's response) the SourcingAssistant UI — must
// go through `findMatchingSites` here. No component/route is allowed to
// reimplement its own "does this site match that location" comparison.
//
// Reuses the SAME geography hierarchy already used for supplier-locality
// classification (see ./geography.ts's resolveState + supplier-search.ts's
// classifyLocality) rather than inventing a parallel location model —
// PricingDistrict -> PricingState, loaded once per request via
// sourcing-data.ts's loadGeographyIndex() and passed in as `geography`.
//
// MATCHING RULE (deliberately conservative — see the feature spec §6):
//   1. Exact/near-exact match against the site's own `city` — the strongest
//      signal, and the ONLY one used when the site has a city on file. A
//      site with a specific city (e.g. "Erode") must NEVER be considered a
//      match for a different city's request (e.g. "Chennai") merely because
//      both happen to resolve to the same state — that STATE-level broadening
//      is reserved for supplier-locality disclosure (classifyLocality), not
//      for automatic site selection, which must stay unambiguous.
//   2. Only when the site has NO city on file does a state-level comparison
//      (direct or via the geography hierarchy) apply, as the "strongest
//      available normalized information" for that site.
//
// This module is PURE (no Prisma) so it is unit-testable like the rest of
// lib/sourcing/*; the Prisma read lives in session-store.ts's
// findMatchingSitesForBuilder().

import { resolveState, type GeographyIndex } from "./geography";

export type MatchableSite = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
};

/** Tight normalization: lowercase, trimmed, whitespace-stripped — same
 * convention as geography.ts's `tight()`, so "Tamil Nadu" and "Tamilnadu"
 * (or "Erode " and "erode") are never treated as different places. */
function tight(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * True when `site` is a location match for `requestedLocation`. Exported
 * separately from `findMatchingSites` so a caller that already has a single
 * candidate site (e.g. re-checking whether the currently-selected site is
 * still a match, to decide whether to show an override warning) does not
 * need to re-filter a whole list.
 */
export function isSiteLocationMatch(
  site: MatchableSite,
  requestedLocation: string | null,
  geography?: GeographyIndex
): boolean {
  const target = tight(requestedLocation);
  if (!target) return false;

  const city = tight(site.city);
  if (city) {
    return city === target || city.includes(target) || target.includes(city);
  }

  // No city on file for this site — fall back to state, which is the
  // strongest information actually available for it.
  const state = tight(site.state);
  if (!state) return false;

  if (state === target || state.includes(target) || target.includes(state)) return true;

  if (geography) {
    const requestedState = resolveState(requestedLocation, geography);
    if (requestedState && tight(requestedState) === state) return true;
  }

  return false;
}

export type SiteLocationMatchResult<T extends MatchableSite> = {
  /** Normalized to null when no location could be determined — the caller
   * must never treat an empty string as "the customer wants nowhere". */
  requestedLocation: string | null;
  /** Active sites (only) whose location matches `requestedLocation`. Always
   * empty when `requestedLocation` is null — the absence of a requested
   * location must never be conflated with "zero sites match". */
  matches: T[];
};

/**
 * Filters `sites` down to the ones that match `requestedLocation`.
 *
 * Deliberately returns an empty `matches` array (with `requestedLocation:
 * null`) whenever no location could be determined, rather than falling back
 * to "all sites" — the caller must ask the customer explicitly in that case,
 * never assume any one site is intended (feature spec §4/§13).
 */
export function findMatchingSites<T extends MatchableSite>(
  sites: T[],
  requestedLocation: string | null,
  geography?: GeographyIndex
): SiteLocationMatchResult<T> {
  const target = tight(requestedLocation);
  if (!target) {
    return { requestedLocation: null, matches: [] };
  }

  return {
    requestedLocation,
    matches: sites.filter((site) => isSiteLocationMatch(site, requestedLocation, geography)),
  };
}
