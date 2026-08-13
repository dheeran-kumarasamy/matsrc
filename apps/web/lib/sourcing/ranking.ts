// `rank_suppliers` — deterministic supplier recommendation engine (§8).
//
// The LLM NEVER produces a score, a rank or a reason string. It receives this
// module's output and paraphrases it. That is what makes the recommendation
// auditable: SourcingRecommendation stores exactly these numbers and reasons.
//
// SCORING MODEL (transparent, weighted, 0-100):
//
//   landedCost      50 pts  — cheapest COMPARABLE landed cost gets full marks,
//                             others scale linearly against the cheapest.
//   deliverySpeed   20 pts  — fastest known delivery gets full marks.
//   reliability     20 pts  — historical SupplierRating, 0-5 scaled to 0-20.
//   specMatch       10 pts  — exact brand/spec match.
//
// A factor whose data is MISSING contributes 0 and is recorded in `dataGaps` —
// it is never imputed to an average or a favourable default, because that
// would fabricate a competitive advantage the supplier hasn't demonstrated.
//
// THE CENTRAL BEHAVIOUR (§7): ranking is driven by LANDED cost, not unit
// material price. A supplier with a lower ₹/bag but higher freight must rank
// BELOW one whose delivered total is cheaper. This is covered by an explicit
// test in ranking.spec.ts.

import { isComparableLandedCost } from "./landed-cost";
import type {
  LandedCostBreakdown,
  RankedSupplierOption,
  SourcingSupplierCandidate,
} from "./types";

export const WEIGHTS = {
  landedCost: 50,
  deliverySpeed: 20,
  reliability: 20,
  specificationMatch: 10,
} as const;

export const MAX_SCORE =
  WEIGHTS.landedCost + WEIGHTS.deliverySpeed + WEIGHTS.reliability + WEIGHTS.specificationMatch;

export type RankingCandidate = {
  candidate: SourcingSupplierCandidate;
  landedCost: LandedCostBreakdown;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type ScoredEntry = {
  entry: RankingCandidate;
  score: number;
  dataGaps: string[];
  unitCost: number | null;
};

/**
 * Builds the factual reason list for one option. Every reason is a statement
 * about data we actually hold — comparative claims ("Lowest estimated landed
 * cost") are only emitted when the comparison was genuinely computed.
 */
function buildReasons(
  item: ScoredEntry,
  cheapestUnitCost: number | null,
  fastestDelivery: number | null,
  optionCount: number
): string[] {
  const reasons: string[] = [];
  const { entry, unitCost } = item;
  const days = entry.candidate.estimatedDeliveryDays;
  const rating = entry.candidate.historicalRating;

  if (unitCost === null) {
    reasons.push("Current pricing unavailable — fresh quotation required");
  } else if (cheapestUnitCost !== null && unitCost <= cheapestUnitCost) {
    reasons.push("Lowest estimated landed cost");
  } else if (cheapestUnitCost !== null && cheapestUnitCost > 0) {
    const premiumPercent = round2(((unitCost - cheapestUnitCost) / cheapestUnitCost) * 100);
    reasons.push(`Estimated landed cost ${premiumPercent}% above the lowest option`);
  }

  if (typeof days === "number") {
    if (fastestDelivery !== null && days <= fastestDelivery && optionCount > 1) {
      reasons.push(
        `Fastest delivery of the available options (${days} day${days === 1 ? "" : "s"})`
      );
    } else {
      reasons.push(`Delivery in ${days} day${days === 1 ? "" : "s"}`);
    }
  } else {
    reasons.push("No verified delivery-time data");
  }

  if (typeof rating === "number") {
    reasons.push(`Historical supplier rating ${round2(rating)}/5`);
  } else {
    reasons.push("No historical rating yet for this supplier");
  }

  if (entry.candidate.specificationMatch) {
    reasons.push("Product specification matches the requirement");
  }

  if (entry.landedCost.dataGaps.includes("freight")) {
    reasons.push("Freight not included — no verified freight rate for this route");
  }

  return reasons;
}

/**
 * Ranks supplier options. Returns them ordered best-first with rank 1..n.
 *
 * Options with no computable landed cost are still returned (so the assistant
 * can honestly list them as "pricing unavailable") but always rank BELOW every
 * priced option, and never receive a landed-cost score.
 */
export function rankSuppliers(entries: RankingCandidate[]): RankedSupplierOption[] {
  if (entries.length === 0) return [];

  const priced = entries.filter((entry) => entry.landedCost.estimatedLandedCost !== null);

  // The comparison baseline is the cheapest COMPARABLE (freight-inclusive)
  // total when any exists; otherwise the cheapest available total, with the
  // incompleteness surfaced per option via dataGaps.
  const comparable = priced.filter((entry) => isComparableLandedCost(entry.landedCost));
  const baselinePool = comparable.length > 0 ? comparable : priced;

  const unitCostOf = (entry: RankingCandidate) =>
    entry.landedCost.unitLandedCost ?? Number.POSITIVE_INFINITY;

  const cheapestUnitCost =
    baselinePool.length > 0 ? Math.min(...baselinePool.map(unitCostOf)) : null;

  const knownDeliveryDays = entries
    .map((entry) => entry.candidate.estimatedDeliveryDays)
    .filter((days): days is number => typeof days === "number" && Number.isFinite(days));
  const fastestDelivery = knownDeliveryDays.length > 0 ? Math.min(...knownDeliveryDays) : null;
  const slowestDelivery = knownDeliveryDays.length > 0 ? Math.max(...knownDeliveryDays) : null;

  const scored: ScoredEntry[] = entries.map((entry) => {
    const dataGaps: string[] = [...entry.landedCost.dataGaps];
    let score = 0;

    // ── Landed cost (50) ──
    const unitCost = entry.landedCost.unitLandedCost;
    if (unitCost !== null && cheapestUnitCost !== null && cheapestUnitCost > 0 && unitCost > 0) {
      // Linear ratio: the cheapest scores full marks; twice as expensive
      // scores half.
      score += WEIGHTS.landedCost * Math.min(1, cheapestUnitCost / unitCost);
    } else if (unitCost === null) {
      dataGaps.push("landedCost");
    }

    // ── Delivery speed (20) ──
    const days = entry.candidate.estimatedDeliveryDays;
    if (typeof days === "number" && fastestDelivery !== null && slowestDelivery !== null) {
      const spread = slowestDelivery - fastestDelivery;
      const normalized = spread === 0 ? 1 : 1 - (days - fastestDelivery) / spread;
      score += WEIGHTS.deliverySpeed * normalized;
    } else {
      dataGaps.push("deliveryDays");
    }

    // ── Historical reliability (20) ──
    const rating = entry.candidate.historicalRating;
    if (typeof rating === "number" && Number.isFinite(rating)) {
      score += WEIGHTS.reliability * Math.max(0, Math.min(1, rating / 5));
    } else {
      dataGaps.push("historicalRating");
    }

    // ── Specification match (10) ──
    if (entry.candidate.specificationMatch) {
      score += WEIGHTS.specificationMatch;
    }

    return {
      entry,
      score: round2(score),
      dataGaps: Array.from(new Set(dataGaps)),
      unitCost,
    };
  });

  // Sort: priced options first, then score desc, then cheapest unit landed
  // cost, then supplierId for a fully deterministic order (mirrors the
  // tie-break chains already used in lib/resolution.ts).
  scored.sort((a, b) => {
    const aPriced = a.unitCost !== null;
    const bPriced = b.unitCost !== null;
    if (aPriced !== bPriced) return aPriced ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    const aCost = a.unitCost ?? Number.POSITIVE_INFINITY;
    const bCost = b.unitCost ?? Number.POSITIVE_INFINITY;
    if (aCost !== bCost) return aCost - bCost;
    return a.entry.candidate.supplierId < b.entry.candidate.supplierId ? -1 : 1;
  });

  return scored.map((item, index) => ({
    supplierId: item.entry.candidate.supplierId,
    supplierName: item.entry.candidate.supplierName,
    productId: item.entry.candidate.productId,
    rank: index + 1,
    recommendationScore: item.score,
    reasons: buildReasons(item, cheapestUnitCost, fastestDelivery, entries.length),
    dataGaps: item.dataGaps,
    landedCost: item.entry.landedCost,
    candidate: item.entry.candidate,
  }));
}

/**
 * Whether there is enough data to present the top option as a RECOMMENDATION
 * at all (§9: "do not claim that something is the 'best' unless there is
 * sufficient data to support the recommendation").
 */
export function canRecommend(options: RankedSupplierOption[]): boolean {
  if (options.length === 0) return false;
  return options[0].landedCost.estimatedLandedCost !== null;
}

/**
 * The customer-facing headline for the top option. Wording is deliberately
 * hedged per §9 — never an unsupported absolute claim. With a single option
 * there is nothing to compare, so it is "the only available option".
 */
export function recommendationHeadline(options: RankedSupplierOption[]): string | null {
  if (!canRecommend(options)) return null;
  return options.length === 1
    ? "Only available option based on current data"
    : "Best available option based on current data";
}
