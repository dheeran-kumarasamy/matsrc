// Nearest-match matcher for the homepage "Quick Material Request" flow.
//
// Pure functions only (no Prisma/fetch imports) so this module is easily
// unit-testable in isolation. Given a free-text material name and the full
// set of public supplier listings, finds the best matching product(s) using
// a 3-stage strategy:
//
//   1. Exact/near-exact match on listing name (and id) — normalized
//      case/whitespace equality or containment.
//   2. Fuzzy/similarity match — token overlap + Levenshtein-distance
//      similarity across name + category + brand, thresholded.
//   3. Category-level fallback — normalized substring/similarity match
//      against category only.
//
// IMPORTANT: inactive/delisted listings (`active !== true`) are filtered out
// BEFORE any matching stage runs — inactive listings are never matched, at
// any stage, for any reason.
//
// Matches are grouped by canonical product (canonicalProductId, falling
// back to listing id) so that multiple suppliers carrying the same/
// equivalent product are detected as one logical "product match" with
// several supplier candidates — this drives the multi-supplier grouping in
// the calling endpoint. When several distinct canonical groups match (e.g.
// two different products both loosely match the input), ALL distinct groups
// are returned; the caller decides how many to act on.
//
// Tie-break rule (NEW — no existing reusable rating/ranking logic was found
// anywhere in this repo; see note in project docs): within a canonical
// group, the winning listing/supplier is chosen by:
//   1. Highest average SupplierRating (avg of deliveryRating + qualityRating)
//   2. Most recently updated listing (`updatedAt` desc)
//   3. Lowest price
//   4. Lowest listingId (deterministic last resort)
// This mirrors the *style* of existing tie-break chains in this codebase
// (apps/web/lib/resolution.ts's price -> serviceable qty -> listingId, and
// apps/api/src/supplier/rfqs/best-price-selection.service.ts's price -> lead
// time -> timestamp -> supplier id) but is a NEW rule since no existing
// rating-based ranking exists to reuse.

export type MatchableListing = {
  id: string;
  name: string;
  category: string;
  brand?: string;
  grade?: string;
  active: boolean;
  canonicalProductId?: string | null;
  groupedListingIds?: string[];
  headlineSupplierId?: string;
  supplierId?: string;
  updatedAt?: string | null;
  basePriceRaw?: number;
  price?: string;
};

export type SupplierRatingLookup = (supplierId: string) => number | null | undefined;

export type MatchStage = "exact" | "fuzzy" | "category" | "none";

export type MatchedCandidate = {
  listing: MatchableListing;
  score: number;
};

export type MatchedGroup = {
  canonicalKey: string;
  stage: MatchStage;
  candidates: MatchedCandidate[];
  winner: MatchableListing;
  tieBreakReason: string;
};

export type MatchResult = {
  matched: boolean;
  stage: MatchStage;
  groups: MatchedGroup[];
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

// Classic Levenshtein edit-distance, O(n*m). Inputs here are short product
// names/categories so this is fast enough without a fancier algorithm.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

// Normalized string similarity in [0, 1] — 1 means identical.
function stringSimilarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);
  if (!normA && !normB) return 1;
  if (!normA || !normB) return 0;

  const distance = levenshtein(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

// Token-overlap score in [0, 1] — proportion of query tokens found (exactly
// or via a close per-token similarity) among the target's tokens.
function tokenOverlapScore(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const targetSet = new Set(targetTokens);

  let matchedCount = 0;
  for (const token of queryTokens) {
    if (targetSet.has(token)) {
      matchedCount += 1;
      continue;
    }
    // allow a close per-token match (typo tolerance), e.g. "sement" ~ "cement"
    const closeMatch = targetTokens.some((t) => stringSimilarity(token, t) >= 0.75);
    if (closeMatch) matchedCount += 0.75;
  }

  return matchedCount / queryTokens.length;
}

const EXACT_MATCH_THRESHOLD = 0.92;
const FUZZY_MATCH_THRESHOLD = 0.55;
const CATEGORY_MATCH_THRESHOLD = 0.55;

function canonicalKeyOf(listing: MatchableListing): string {
  return listing.canonicalProductId || listing.id;
}

function groupByCanonicalKey(listings: MatchableListing[]): Map<string, MatchableListing[]> {
  const groups = new Map<string, MatchableListing[]>();
  for (const listing of listings) {
    const key = canonicalKeyOf(listing);
    const existing = groups.get(key);
    if (existing) existing.push(listing);
    else groups.set(key, [listing]);
  }
  return groups;
}

function priceOf(listing: MatchableListing): number {
  if (typeof listing.basePriceRaw === "number") return listing.basePriceRaw;
  if (listing.price) {
    const numeric = Number(listing.price.replace(/[^\d.]/g, ""));
    return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

function updatedAtOf(listing: MatchableListing): number {
  if (!listing.updatedAt) return 0;
  const t = new Date(listing.updatedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Picks the winning listing within a canonical group of matched candidates
 * using the documented NEW tie-break rule: rating (desc) -> recency (desc)
 * -> price (asc) -> listingId (asc, deterministic last resort).
 */
export function pickTieBreakWinner(
  candidates: MatchableListing[],
  getSupplierRating: SupplierRatingLookup
): { winner: MatchableListing; reason: string } {
  if (candidates.length === 1) {
    return { winner: candidates[0], reason: "only candidate" };
  }

  let winner = candidates[0];
  let winnerRating = getSupplierRating(winner.supplierId || winner.headlineSupplierId || "") ?? null;

  for (const candidate of candidates.slice(1)) {
    const candidateRating = getSupplierRating(candidate.supplierId || candidate.headlineSupplierId || "") ?? null;

    const winnerRatingValue = winnerRating ?? -1;
    const candidateRatingValue = candidateRating ?? -1;

    if (candidateRatingValue > winnerRatingValue) {
      winner = candidate;
      winnerRating = candidateRating;
      continue;
    }
    if (candidateRatingValue < winnerRatingValue) continue;

    // Rating tied -> most recently updated listing wins.
    const winnerUpdatedAt = updatedAtOf(winner);
    const candidateUpdatedAt = updatedAtOf(candidate);
    if (candidateUpdatedAt > winnerUpdatedAt) {
      winner = candidate;
      continue;
    }
    if (candidateUpdatedAt < winnerUpdatedAt) continue;

    // Recency tied -> lowest price wins.
    const winnerPrice = priceOf(winner);
    const candidatePrice = priceOf(candidate);
    if (candidatePrice < winnerPrice) {
      winner = candidate;
      continue;
    }
    if (candidatePrice > winnerPrice) continue;

    // Price tied -> deterministic listingId tie-break (last resort).
    if (candidate.id < winner.id) {
      winner = candidate;
    }
  }

  const reason = `rating(${winnerRating ?? "n/a"}) > recency > price > listingId`;
  return { winner, reason };
}

/**
 * Runs the 3-stage nearest-match strategy against `materialName`. Only
 * considers `active === true` listings at every stage. Returns ALL distinct
 * canonical-product groups that matched at the first stage that produces
 * any match (exact takes priority over fuzzy, fuzzy over category).
 */
export function matchQuickRequest(
  materialName: string,
  allListings: MatchableListing[],
  getSupplierRating: SupplierRatingLookup = () => null
): MatchResult {
  const query = materialName.trim();
  console.log(`[quick-request-matcher] input received: "${query}"`);

  const activeListings = allListings.filter((listing) => listing.active === true);
  console.log(
    `[quick-request-matcher] active listings available: ${activeListings.length} (of ${allListings.length} total)`
  );

  if (!query || activeListings.length === 0) {
    console.log("[quick-request-matcher] no query or no active listings — fallback triggered (none)");
    return { matched: false, stage: "none", groups: [] };
  }

  const queryTokens = tokenize(query);
  const normalizedQuery = normalize(query);

  // Stage 1: exact / near-exact match on name or id.
  const exactCandidates = activeListings.filter((listing) => {
    const normalizedName = normalize(listing.name || "");
    if (!normalizedName) return false;
    if (normalizedName === normalizedQuery) return true;
    if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) return true;
    return stringSimilarity(listing.name || "", query) >= EXACT_MATCH_THRESHOLD;
  });

  console.log(`[quick-request-matcher] stage 1 (exact) candidates found: ${exactCandidates.length}`);

  if (exactCandidates.length > 0) {
    const groups = buildMatchedGroups(exactCandidates, "exact", getSupplierRating);
    console.log(
      `[quick-request-matcher] match selected at stage=exact, distinct product groups: ${groups.length}`
    );
    return { matched: true, stage: "exact", groups };
  }

  // Stage 2: fuzzy match across name + category + brand.
  const scored = activeListings
    .map((listing) => {
      const nameTokens = tokenize(listing.name || "");
      const categoryTokens = tokenize(listing.category || "");
      const brandTokens = tokenize(listing.brand || "");
      const combinedTokens = [...nameTokens, ...categoryTokens, ...brandTokens];

      const overlapScore = tokenOverlapScore(queryTokens, combinedTokens);
      const nameSimilarity = stringSimilarity(listing.name || "", query);
      const score = Math.max(overlapScore, nameSimilarity);

      return { listing, score };
    })
    .filter((entry) => entry.score >= FUZZY_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  console.log(`[quick-request-matcher] stage 2 (fuzzy) candidates found: ${scored.length}`);

  if (scored.length > 0) {
    const groups = buildMatchedGroups(
      scored.map((s) => s.listing),
      "fuzzy",
      getSupplierRating,
      new Map(scored.map((s) => [s.listing.id, s.score]))
    );
    console.log(
      `[quick-request-matcher] match selected at stage=fuzzy, distinct product groups: ${groups.length}`
    );
    return { matched: true, stage: "fuzzy", groups };
  }

  // Stage 3: category-level fallback.
  const categoryCandidates = activeListings
    .map((listing) => ({
      listing,
      score: stringSimilarity(listing.category || "", query),
    }))
    .filter((entry) => entry.score >= CATEGORY_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  console.log(`[quick-request-matcher] stage 3 (category) candidates found: ${categoryCandidates.length}`);

  if (categoryCandidates.length > 0) {
    const groups = buildMatchedGroups(
      categoryCandidates.map((c) => c.listing),
      "category",
      getSupplierRating,
      new Map(categoryCandidates.map((c) => [c.listing.id, c.score]))
    );
    console.log(
      `[quick-request-matcher] match selected at stage=category, distinct product groups: ${groups.length}`
    );
    return { matched: true, stage: "category", groups };
  }

  console.log("[quick-request-matcher] no match at any stage — fallback triggered (no-match)");
  return { matched: false, stage: "none", groups: [] };
}

function buildMatchedGroups(
  candidates: MatchableListing[],
  stage: MatchStage,
  getSupplierRating: SupplierRatingLookup,
  scores?: Map<string, number>
): MatchedGroup[] {
  const grouped = groupByCanonicalKey(candidates);
  const result: MatchedGroup[] = [];

  for (const [canonicalKey, groupListings] of grouped.entries()) {
    const { winner, reason } = pickTieBreakWinner(groupListings, getSupplierRating);
    console.log(
      `[quick-request-matcher] tie-break applied for group "${canonicalKey}": winner=${winner.id} supplier=${winner.supplierId || winner.headlineSupplierId} (${reason})`
    );

    result.push({
      canonicalKey,
      stage,
      candidates: groupListings.map((listing) => ({
        listing,
        score: scores?.get(listing.id) ?? 1,
      })),
      winner,
      tieBreakReason: reason,
    });
  }

  return result;
}
