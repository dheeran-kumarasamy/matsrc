// `search_products` — the AI Sourcing Assistant's product-matching tool (§5).
//
// REUSE NOTE: this deliberately builds ON TOP OF the existing
// lib/quick-request-matcher.ts (3-stage exact -> fuzzy -> category matching
// with Levenshtein + token-overlap scoring, already used by the homepage
// Quick Material Request flow) rather than introducing a second matching
// engine. What this module adds on top is the sourcing-specific concerns the
// quick-request flow doesn't have:
//
//   1. SPEC/SIZE AWARENESS — "12mm TMT" must not be answered with a 16mm
//      listing. A size mentioned in the requirement becomes a hard filter,
//      and near-miss sizes are returned as `alternatives` so the assistant
//      can offer them (the §24 "I found 10mm and 16mm options" behaviour)
//      instead of silently substituting the wrong SKU.
//   2. SYNONYM NORMALIZATION — "12 mm TMT rod" / "12mm TMT" /
//      "12 millimeter steel rod" must all resolve to the same catalogue
//      product (§25).
//   3. CONFIDENCE GATING — a category-stage-only match is never reported as
//      confident; it becomes a clarification prompt (§5 "if there is no
//      confident match, ask for clarification or present possible matches").
//
// Pure functions only (no Prisma/fetch), so it is unit-testable in isolation
// and runs under apps/web's existing `lib/**/*.spec.ts` vitest glob — the same
// convention quick-request-matcher.ts follows.

import { matchQuickRequest, type MatchableListing } from "../quick-request-matcher";
import type { ProductSearchOutcome, SourcingProductMatch, SourcingRequirement } from "./types";

/**
 * A matchable listing plus the unit label the sourcing result needs.
 *
 * MatchableListing (owned by quick-request-matcher.ts, shared with the homepage
 * Quick Request flow) deliberately has no `unit` field. Rather than widen that
 * shared type — and risk changing behaviour for the existing flow — the unit is
 * layered on here as an optional extra property.
 */
export type SourcingMatchableListing = MatchableListing & { unit?: string };

/**
 * Material synonym expansion. Maps customer vocabulary onto the words that
 * actually appear in catalogue product names/categories.
 *
 * Only bidirectionally-safe construction-industry synonyms are listed — e.g.
 * "rod"/"bar" for TMT. Nothing here asserts a product exists; it only widens
 * the text used for matching against REAL listings.
 */
const MATERIAL_SYNONYMS: Record<string, string[]> = {
  tmt: ["tmt", "bar", "rod", "rebar", "steel", "reinforcement"],
  steel: ["steel", "tmt", "bar", "rod", "rebar"],
  rod: ["rod", "bar", "tmt", "steel"],
  bar: ["bar", "rod", "tmt", "steel"],
  rebar: ["rebar", "tmt", "bar", "rod", "steel"],
  cement: ["cement", "opc", "ppc", "psc"],
  ppc: ["ppc", "cement", "portland pozzolana"],
  opc: ["opc", "cement", "ordinary portland"],
  psc: ["psc", "cement", "portland slag"],
  aac: ["aac", "block", "autoclaved", "aerated"],
  block: ["block", "blocks"],
  brick: ["brick", "bricks"],
  sand: ["sand", "msand", "m-sand", "psand", "p-sand"],
  aggregate: ["aggregate", "jelly", "metal", "blue metal"],
  jelly: ["jelly", "aggregate", "blue metal"],
  rmc: ["rmc", "ready mix", "concrete"],
  pipe: ["pipe", "pipes", "pvc", "cpvc"],
  ply: ["ply", "plywood"],
  plywood: ["plywood", "ply"],
};

/** Millimetre spellings that all normalize to "mm". */
const MM_SPELLINGS = [
  "millimeters",
  "millimetres",
  "millimeter",
  "millimetre",
  "mm",
];

/**
 * Normalizes size expressions inside a free-text string so every spelling
 * collapses to the canonical "<n>mm" form:
 *   "12 mm" -> "12mm", "12 millimeter" -> "12mm", "12MM" -> "12mm"
 */
export function normalizeSizeTokens(input: string): string {
  let output = input.toLowerCase();
  for (const spelling of MM_SPELLINGS) {
    output = output.replace(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${spelling}\b`, "g"), "$1mm");
  }
  return output.replace(/\s+/g, " ").trim();
}

/** Extracts the canonical size token ("12mm") from text, if present. */
export function extractSizeToken(input: string): string | null {
  const match = normalizeSizeTokens(input).match(/\b(\d+(?:\.\d+)?)mm\b/);
  return match ? `${match[1]}mm` : null;
}

/**
 * Builds the PRIMARY (unexpanded) search string for a requirement: material +
 * specification + brand, with size spellings normalized.
 *
 * Deliberately NOT synonym-expanded. The underlying matcher scores by
 * `matchedTokens / queryTokens`, so padding the query with synonyms that don't
 * appear in the listing actively LOWERS the score and can push a genuine match
 * below the fuzzy threshold. Synonyms are applied as substitution variants
 * instead — see buildSearchQueries().
 */
export function buildSearchQuery(requirement: SourcingRequirement): string {
  const parts = [requirement.material, requirement.specification, requirement.brand]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");

  return normalizeSizeTokens(parts);
}

/** Max synonym variants attempted, to bound the work per search. */
const MAX_QUERY_VARIANTS = 12;

/**
 * Ordered list of queries to try: the precise query first, then one variant
 * per synonym SUBSTITUTION (replacing a single token with an equivalent), and
 * finally the material alone.
 *
 * Substitution rather than accumulation is what makes "rebar 12mm" reach a
 * listing named "TMT Steel 12mm" (via the "rebar" -> "tmt" variant) while
 * keeping the precise "TMT steel 12mm" query at full score.
 */
export function buildSearchQueries(requirement: SourcingRequirement): string[] {
  const primary = buildSearchQuery(requirement);
  if (!primary) return [];

  const queries: string[] = [primary];
  const tokens = primary.split(" ").filter(Boolean);

  for (let index = 0; index < tokens.length; index += 1) {
    for (const synonym of MATERIAL_SYNONYMS[tokens[index]] ?? []) {
      if (synonym === tokens[index]) continue;
      const variant = [...tokens.slice(0, index), synonym, ...tokens.slice(index + 1)].join(" ");
      if (!queries.includes(variant)) queries.push(variant);
      if (queries.length >= MAX_QUERY_VARIANTS) return queries;
    }
  }

  // Last resort: the material on its own (keeps the size filter doing the
  // precision work downstream).
  const materialOnly = normalizeSizeTokens(requirement.material ?? "");
  if (materialOnly && !queries.includes(materialOnly)) queries.push(materialOnly);

  return queries;
}

/** Confidence floor below which a match must not be presented as certain. */
export const CONFIDENT_MATCH_THRESHOLD = 0.5;

/** Searchable text for a listing (name + category + brand + grade). */
function listingText(listing: SourcingMatchableListing): string {
  return normalizeSizeTokens(
    [listing.name, listing.category, listing.brand ?? "", listing.grade ?? ""].join(" ")
  );
}

function toProductMatch(
  listing: SourcingMatchableListing,
  confidence: number,
  stage: "exact" | "fuzzy" | "category"
): SourcingProductMatch {
  return {
    productId: listing.id,
    canonicalProductId: listing.canonicalProductId ?? null,
    name: listing.name,
    category: listing.category,
    brand: listing.brand ?? null,
    grade: listing.grade ?? null,
    unit: listing.unit ?? "",
    confidence,
    stage,
  };
}

export type ProductSearchInput = {
  requirement: SourcingRequirement;
  /** Live listings (already includes only what the platform really has). */
  listings: SourcingMatchableListing[];
  /** Average supplier rating lookup, reused by the matcher's tie-break. */
  getSupplierRating?: (supplierId: string) => number | null | undefined;
};

/**
 * `search_products` tool implementation.
 *
 * Returns confident matches when the catalogue genuinely contains the
 * requested product, and otherwise returns `needsClarification` with the
 * closest real alternatives. It NEVER invents a product or silently
 * substitutes a different specification.
 */
export function searchProducts({
  requirement,
  listings,
  getSupplierRating = () => null,
}: ProductSearchInput): ProductSearchOutcome {
  const empty: ProductSearchOutcome = {
    confident: false,
    matches: [],
    needsClarification: true,
    alternatives: [],
  };

  if (!requirement.material || listings.length === 0) {
    return empty;
  }

  const queries = buildSearchQueries(requirement);
  if (queries.length === 0) return empty;

  const requestedSize =
    extractSizeToken(requirement.specification ?? "") ??
    extractSizeToken(requirement.material ?? "");

  // Try the precise query first, then synonym-substitution variants. The first
  // variant that yields at least one listing matching the requested size wins;
  // if none does, the best non-empty result is kept so its listings can be
  // offered as honest alternatives.
  //
  // Inactive listings are filtered by the underlying matcher (it drops
  // `active !== true` before any stage runs) — not duplicated here.
  let chosen: {
    stage: "exact" | "fuzzy" | "category";
    flattened: Array<{ listing: SourcingMatchableListing; score: number }>;
  } | null = null;

  for (const query of queries) {
    const result = matchQuickRequest(query, listings, getSupplierRating);
    if (!result.matched || result.groups.length === 0) continue;

    const seen = new Set<string>();
    const flattened: Array<{ listing: SourcingMatchableListing; score: number }> = [];
    for (const group of result.groups) {
      for (const candidate of group.candidates) {
        if (seen.has(candidate.listing.id)) continue;
        seen.add(candidate.listing.id);
        flattened.push({ listing: candidate.listing, score: candidate.score });
      }
    }
    if (flattened.length === 0) continue;

    const stage = result.stage === "none" ? "category" : result.stage;
    if (!chosen) chosen = { stage, flattened };

    // A variant that actually reaches the requested size is definitive.
    if (!requestedSize) break;
    if (flattened.some((entry) => listingText(entry.listing).includes(requestedSize))) {
      chosen = { stage, flattened };
      break;
    }
  }

  if (!chosen) return empty;

  const { stage, flattened } = chosen;

  // A requested size is a HARD filter. Everything else that matched the
  // material but carries a different size becomes an `alternative` we can
  // offer, never a silent substitution (§24 no-product-found behaviour).
  let matched = flattened;
  let sizeAlternatives: Array<{ listing: SourcingMatchableListing; score: number }> = [];

  if (requestedSize) {
    const withSize = flattened.filter((entry) => listingText(entry.listing).includes(requestedSize));
    const withoutSize = flattened.filter(
      (entry) => !listingText(entry.listing).includes(requestedSize)
    );
    matched = withSize;
    // Only offer alternatives that are the same KIND of product (they carry
    // some size token of their own), so we don't propose cement for a 12mm
    // steel request.
    sizeAlternatives = withoutSize.filter((entry) => extractSizeToken(listingText(entry.listing)));
  }

  // A requested brand is also a hard filter when the catalogue actually has
  // that brand; otherwise it degrades to "no brand match" rather than
  // pretending an unbranded listing is the requested brand.
  if (requirement.brand) {
    const brandKey = requirement.brand.toLowerCase();
    const withBrand = matched.filter((entry) =>
      (entry.listing.brand ?? "").toLowerCase().includes(brandKey)
    );
    if (withBrand.length > 0) {
      matched = withBrand;
    }
  }

  const sortByScore = (a: { score: number }, b: { score: number }) => b.score - a.score;

  const matches = matched
    .sort(sortByScore)
    .map((entry) => toProductMatch(entry.listing, entry.score, stage));

  const alternatives = sizeAlternatives
    .sort(sortByScore)
    .slice(0, 5)
    .map((entry) => toProductMatch(entry.listing, entry.score, stage));

  // "Confident" requires a real name/spec-level match. A category-stage match
  // means we only matched the broad material family, which is exactly the
  // case the spec says must ask rather than assume.
  const confident =
    matches.length > 0 &&
    stage !== "category" &&
    matches[0].confidence >= CONFIDENT_MATCH_THRESHOLD;

  return {
    confident,
    matches,
    needsClarification: !confident,
    alternatives: confident ? [] : alternatives.length > 0 ? alternatives : matches.slice(0, 5),
  };
}
