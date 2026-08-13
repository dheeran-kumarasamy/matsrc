// The sourcing turn pipeline — the fixed tool sequence for one customer message.
//
// FLOW (§15's Understand -> Search -> Compare -> Recommend):
//   parse_requirement
//     -> (incomplete?) ask ONE clarification question and stop
//   search_products
//     -> (no confident match?) present real alternatives and stop
//   find_suppliers
//     -> (none?) say so plainly and stop
//   get_current_prices + calculate_landed_cost   [deterministic]
//   rank_suppliers                                [deterministic]
//   explain                                       [AI, optional]
//
// The sequence is code, not a model decision — the LLM cannot skip a step,
// invent a step, or call a tool out of order (§20 unauthorized tool invocation).

import { explainRecommendation, parseRequirement } from "./agent";
import { calculateLandedCost } from "./landed-cost";
import { resolveFreight } from "./price-lookup";
import { searchProducts } from "./product-search";
import { canRecommend, rankSuppliers, recommendationHeadline } from "./ranking";
import { isRequirementComplete, nextClarificationQuestion } from "./requirement-extractor";
import {
  loadFreightObservations,
  loadMasterData,
  loadSourcingListings,
  loadSupplierLeadTimes,
} from "./sourcing-data";
import { findSuppliers, partitionByLocation } from "./supplier-search";
import type {
  ProductSearchOutcome,
  RankedSupplierOption,
  SourcingRequirement,
  SourcingSupplierCandidate,
} from "./types";

/** What the UI needs to render one assistant turn. */
export type SourcingTurnResult = {
  /** Which stage the session reached — drives the UI progress rail. */
  stage: "COLLECTING" | "NO_PRODUCT" | "NO_SUPPLIER" | "RECOMMENDED";
  requirement: SourcingRequirement;
  /** The assistant's message for this turn. */
  message: string;
  /** Present only while information necessary for sourcing is missing. */
  question: string | null;
  productSearch: ProductSearchOutcome | null;
  suppliers: SourcingSupplierCandidate[];
  options: RankedSupplierOption[];
  headline: string | null;
  /** True when a consequential action is available and needs approval (§14). */
  awaitingApproval: boolean;
  diagnostics: {
    requirementSource: "ai" | "deterministic";
    aiFailed: boolean;
    explanationSource: "ai" | "template" | null;
    latencyMs: number;
  };
};

export type RunTurnInput = {
  message: string;
  existing: SourcingRequirement;
  now?: Date;
};

/**
 * Runs one full sourcing turn. Every figure in the result is computed by the
 * deterministic modules; only `message` may have been phrased by the LLM.
 */
export async function runSourcingTurn(input: RunTurnInput): Promise<SourcingTurnResult> {
  const started = Date.now();
  const masterData = await loadMasterData();

  // ── 1. parse_requirement ──
  const extraction = await parseRequirement({
    message: input.message,
    existing: input.existing,
    knownBrands: masterData.brands,
    knownLocations: masterData.locations,
    now: input.now,
  });

  const requirement = extraction.requirement;
  const baseDiagnostics = {
    requirementSource: extraction.source,
    aiFailed: extraction.aiFailed,
    explanationSource: null as "ai" | "template" | null,
  };

  // ── 2. Ask ONLY if something sourcing-critical is missing ──
  if (!isRequirementComplete(requirement)) {
    const question = nextClarificationQuestion(requirement);
    return {
      stage: "COLLECTING",
      requirement,
      message: question ?? "Could you tell me a little more about what you need?",
      question,
      productSearch: null,
      suppliers: [],
      options: [],
      headline: null,
      awaitingApproval: false,
      diagnostics: { ...baseDiagnostics, latencyMs: Date.now() - started },
    };
  }

  // ── 3. search_products ──
  const { matchable, rows } = await loadSourcingListings();
  const productSearch = searchProducts({ requirement, listings: matchable });

  if (!productSearch.confident) {
    return {
      stage: "NO_PRODUCT",
      requirement,
      message: buildNoProductMessage(requirement, productSearch),
      question: null,
      productSearch,
      suppliers: [],
      options: [],
      headline: null,
      awaitingApproval: false,
      diagnostics: { ...baseDiagnostics, latencyMs: Date.now() - started },
    };
  }

  // ── 4. find_suppliers ──
  const leadTimes = await loadSupplierLeadTimes();
  const rowsWithLeadTimes = rows.map((row) => ({
    ...row,
    leadTimeDays: leadTimes.get(row.supplierId) ?? null,
  }));

  const allCandidates = findSuppliers({
    requirement,
    productMatches: productSearch.matches,
    listings: rowsWithLeadTimes,
  });

  // Prefer suppliers in the requested region, but never hide the others — this
  // platform has no serviceability model, so out-of-region is not proof of
  // "cannot deliver" (see supplier-search.partitionByLocation).
  const { local, other } = partitionByLocation(allCandidates, requirement.location);
  const candidates = local.length > 0 ? local : other;

  if (candidates.length === 0) {
    return {
      stage: "NO_SUPPLIER",
      requirement,
      message: `I couldn't find a supplier currently matching this requirement${
        requirement.location ? ` in ${requirement.location}` : ""
      }. I can request fresh quotations from suppliers who carry this material instead.`,
      question: null,
      productSearch,
      suppliers: [],
      options: [],
      headline: null,
      awaitingApproval: false,
      diagnostics: { ...baseDiagnostics, latencyMs: Date.now() - started },
    };
  }

  // ── 5. get_current_prices + calculate_landed_cost (deterministic) ──
  const freightByProduct = await loadFreightObservations(
    candidates.map((candidate) => candidate.productId)
  );

  const ranking = candidates.map((candidate) => {
    const observations = freightByProduct.get(candidate.productId) ?? [];
    const { freight } = resolveFreight(observations, requirement.location);

    return {
      candidate,
      landedCost: calculateLandedCost({
        quantity: requirement.quantity ?? 0,
        unitMaterialPrice: candidate.basePrice,
        freightCost: freight,
        // No supplier-stated delivery/handling charges are modelled in this
        // schema; null keeps them out of the total and flags the gap.
        deliveryCharges: null,
        handlingCharges: null,
      }),
    };
  });

  // ── 6. rank_suppliers (deterministic) ──
  const options = rankSuppliers(ranking);
  const headline = recommendationHeadline(options);

  // ── 7. explain (AI optional; the facts are already fixed) ──
  const explanation = await explainRecommendation(
    headline ?? "Available options based on current data",
    requirement,
    options
  );

  return {
    stage: "RECOMMENDED",
    requirement,
    message: explanation.text,
    question: null,
    productSearch,
    suppliers: candidates,
    options,
    headline,
    // Approval is only meaningful when there is something concrete to approve.
    awaitingApproval: canRecommend(options),
    diagnostics: {
      ...baseDiagnostics,
      explanationSource: explanation.source,
      latencyMs: Date.now() - started,
    },
  };
}

/** §24's "no product found" wording, grounded in the real alternatives found. */
function buildNoProductMessage(
  requirement: SourcingRequirement,
  outcome: ProductSearchOutcome
): string {
  const asked = [requirement.specification, requirement.material].filter(Boolean).join(" ");

  if (outcome.alternatives.length === 0) {
    return `I couldn't find a match for ${
      asked || "that material"
    } in the current catalogue. Could you describe the product differently, or tell me the exact specification you need?`;
  }

  const names = Array.from(new Set(outcome.alternatives.map((match) => match.name))).slice(0, 4);
  return `I couldn't find an exact match for ${
    asked || "that material"
  } in the current catalogue. I found ${names.join(
    ", "
  )}. Would you like to source one of those, or specify another product?`;
}
