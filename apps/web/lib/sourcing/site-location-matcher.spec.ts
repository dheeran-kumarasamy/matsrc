// Location-aware site selection — the single authoritative matcher under
// test. Every scenario in the feature spec's §22 test list that concerns
// MATCHING (as opposed to server plumbing/UI) is covered here.

import { describe, expect, it } from "vitest";

import { buildGeographyIndex } from "./geography";
import { findMatchingSites, isSiteLocationMatch, type MatchableSite } from "./site-location-matcher";

const EAST_SITE: MatchableSite = { id: "site-erode", name: "Erode Site", city: "Erode", state: "Tamil Nadu" };
const CHENNAI_SITE_A: MatchableSite = {
  id: "site-chennai-a",
  name: "Chennai Site A",
  city: "Chennai",
  state: "Tamil Nadu",
};
const CHENNAI_SITE_B: MatchableSite = {
  id: "site-chennai-b",
  name: "Chennai Site B",
  city: "Chennai",
  state: "Tamil Nadu",
};
const COIMBATORE_SITE: MatchableSite = {
  id: "site-cbe",
  name: "Coimbatore Site",
  city: "Coimbatore",
  state: "Tamil Nadu",
};

const DISTRICTS = [
  { name: "Erode", stateName: "Tamil Nadu" },
  { name: "Chennai", stateName: "Tamil Nadu" },
  { name: "Coimbatore", stateName: "Tamil Nadu" },
];
const STATES = [{ name: "Tamil Nadu", code: "TN" }];
const GEOGRAPHY = buildGeographyIndex(DISTRICTS, STATES);

describe("findMatchingSites — never conflates 'no location' with 'no match'", () => {
  it("Test 5/6 — no location -> empty matches, regardless of site count", () => {
    expect(findMatchingSites([EAST_SITE], null)).toEqual({ requestedLocation: null, matches: [] });
    expect(findMatchingSites([EAST_SITE, CHENNAI_SITE_A], null)).toEqual({
      requestedLocation: null,
      matches: [],
    });
  });

  it("an empty/whitespace-only requested location is treated as unknown, not a match target", () => {
    // Normalized to null (never treated as "a location was specified but
    // matches nothing") — same "don't guess" convention as the requirement
    // schema's own null fields.
    expect(findMatchingSites([EAST_SITE], "   ")).toEqual({ requestedLocation: null, matches: [] });
  });
});

describe("findMatchingSites — Test 1: one site, matching location", () => {
  it("selects Erode when the requirement is for Erode", () => {
    const result = findMatchingSites([EAST_SITE], "Erode", GEOGRAPHY);
    expect(result.matches).toEqual([EAST_SITE]);
  });
});

describe("findMatchingSites — Test 2: one site, different location", () => {
  it("does NOT match Erode against a Chennai request — no silent fallback", () => {
    const result = findMatchingSites([EAST_SITE], "Chennai", GEOGRAPHY);
    expect(result.matches).toEqual([]);
  });

  it("does not match even though both sites are in the same state (city is the strongest signal)", () => {
    // Erode and Chennai are both Tamil Nadu districts, but a site with a
    // specific city on file must not be treated as a match for a different
    // city purely via state-level broadening.
    expect(isSiteLocationMatch(EAST_SITE, "Chennai", GEOGRAPHY)).toBe(false);
  });
});

describe("findMatchingSites — Test 3: multiple sites, matching site(s) exist", () => {
  it("returns only the Chennai sites, never Erode, for a Chennai request", () => {
    const result = findMatchingSites([EAST_SITE, CHENNAI_SITE_A, CHENNAI_SITE_B], "Chennai", GEOGRAPHY);
    expect(result.matches.map((s) => s.id).sort()).toEqual(
      [CHENNAI_SITE_A.id, CHENNAI_SITE_B.id].sort()
    );
    expect(result.matches).not.toContainEqual(EAST_SITE);
  });
});

describe("findMatchingSites — Test 4: multiple sites, no matching site", () => {
  it("returns no matches when neither Erode nor Coimbatore is Chennai", () => {
    const result = findMatchingSites([EAST_SITE, COIMBATORE_SITE], "Chennai", GEOGRAPHY);
    expect(result.matches).toEqual([]);
  });
});

describe("isSiteLocationMatch — state-only fallback for sites with no city", () => {
  it("falls back to state comparison when the site has no city on file", () => {
    const stateOnlySite: MatchableSite = { id: "s1", name: "TN Site", city: null, state: "Tamil Nadu" };
    // A request that resolves (via the district->state hierarchy) to the
    // same state as the site's own state IS a match when city is unknown.
    expect(isSiteLocationMatch(stateOnlySite, "Erode", GEOGRAPHY)).toBe(true);
  });

  it("does not match a site with neither city nor state on file", () => {
    const bareSite: MatchableSite = { id: "s2", name: "Bare Site", city: null, state: null };
    expect(isSiteLocationMatch(bareSite, "Erode", GEOGRAPHY)).toBe(false);
  });
});

describe("isSiteLocationMatch — tolerant of spelling/spacing, not fuzzy across places", () => {
  it("is tolerant of case/whitespace differences for the same place", () => {
    expect(isSiteLocationMatch(EAST_SITE, "erode ", GEOGRAPHY)).toBe(true);
    expect(isSiteLocationMatch(EAST_SITE, " ERODE", GEOGRAPHY)).toBe(true);
  });

  it("never fuzzy-matches genuinely different place names", () => {
    expect(isSiteLocationMatch(EAST_SITE, "Erndoe", GEOGRAPHY)).toBe(false);
  });
});
