// sourcing-scenarios.ts — lightweight deterministic what-if scenario engine
// for the AI Sourcing Intelligence layer (Phase 8).
//
// Scenarios recalculate existing deterministic outputs for modified inputs.
// No orders are created. No database writes occur in this module.
// The LLM receives scenario results and explains them — it never computes them.

import { calculateLandedCost } from "./landed-cost";
import type { LandedCostBreakdown, RankedSupplierOption, SourcingRequirement } from "./types";

export type ScenarioType =
  | "QUANTITY_CHANGE"
  | "SUPPLIER_CHANGE"
  | "LOCATION_CHANGE";

export type ScenarioInput = {
  type: ScenarioType;
  baseRequirement: SourcingRequirement;
  baseOptions: RankedSupplierOption[];
  /** Modified quantity for QUANTITY_CHANGE. */
  newQuantity?: number;
  /** Supplier index (0-based) for SUPPLIER_CHANGE. */
  supplierIndex?: number;
};

export type ScenarioResult = {
  type: ScenarioType;
  /** Human-readable description of the scenario. */
  description: string;
  /** The affected option (original for comparison). */
  original: {
    supplierName: string;
    landedCost: LandedCostBreakdown;
    rank: number;
  } | null;
  /** The scenario outcome. */
  outcome: {
    supplierName: string;
    landedCost: LandedCostBreakdown;
    /** Estimated % change in total landed cost vs original. Null when either is unavailable. */
    costChangePct: number | null;
    reasons: string[];
  } | null;
  dataGaps: string[];
};

/**
 * Runs a what-if scenario over already-computed sourcing options.
 * All arithmetic is deterministic; the AI explains the result.
 */
export function runScenario(input: ScenarioInput): ScenarioResult {
  const { type, baseOptions } = input;

  if (baseOptions.length === 0) {
    return {
      type,
      description: "No current options to compare against.",
      original: null,
      outcome: null,
      dataGaps: ["noBaseOptions"],
    };
  }

  if (type === "QUANTITY_CHANGE") {
    const newQty = input.newQuantity;
    if (!newQty || newQty <= 0) {
      return {
        type,
        description: "Quantity change scenario: invalid quantity.",
        original: null,
        outcome: null,
        dataGaps: ["invalidQuantity"],
      };
    }

    const top = baseOptions[0];
    const originalLandedCost = top.landedCost;

    const newLandedCost = calculateLandedCost({
      quantity: newQty,
      unitMaterialPrice: originalLandedCost.unitMaterialPrice,
      freightCost: originalLandedCost.freightCost,
      deliveryCharges: originalLandedCost.deliveryCharges,
      handlingCharges: originalLandedCost.handlingCharges,
    });

    const originalTotal = originalLandedCost.estimatedLandedCost;
    const newTotal = newLandedCost.estimatedLandedCost;
    const costChangePct =
      originalTotal !== null && newTotal !== null && originalTotal > 0
        ? Number((((newTotal - originalTotal) / originalTotal) * 100).toFixed(2))
        : null;

    const reasons: string[] = [];
    if (newLandedCost.unitLandedCost !== null && originalLandedCost.unitLandedCost !== null) {
      const unitDiff = newLandedCost.unitLandedCost - originalLandedCost.unitLandedCost;
      if (Math.abs(unitDiff) > 0.01) {
        reasons.push(
          `Unit landed cost ${unitDiff > 0 ? "increases" : "decreases"} to ₹${newLandedCost.unitLandedCost.toFixed(2)}.`
        );
      } else {
        reasons.push("Unit landed cost is unchanged — no tier pricing applied.");
      }
    }
    if (newLandedCost.dataGaps.length > 0) {
      reasons.push(`Some cost components are still unavailable: ${newLandedCost.dataGaps.join(", ")}.`);
    }

    return {
      type,
      description: `What if quantity changes from ${input.baseRequirement.quantity} to ${newQty} ${input.baseRequirement.unit ?? "units"}?`,
      original: {
        supplierName: top.supplierName,
        landedCost: originalLandedCost,
        rank: top.rank,
      },
      outcome: {
        supplierName: top.supplierName,
        landedCost: newLandedCost,
        costChangePct,
        reasons,
      },
      dataGaps: newLandedCost.dataGaps,
    };
  }

  if (type === "SUPPLIER_CHANGE") {
    const idx = input.supplierIndex ?? 1;
    if (idx <= 0 || idx >= baseOptions.length) {
      return {
        type,
        description: "Supplier change scenario: no alternative supplier available.",
        original: null,
        outcome: null,
        dataGaps: ["noAlternativeSupplier"],
      };
    }

    const top = baseOptions[0];
    const alt = baseOptions[idx];
    const originalTotal = top.landedCost.estimatedLandedCost;
    const altTotal = alt.landedCost.estimatedLandedCost;
    const costChangePct =
      originalTotal !== null && altTotal !== null && originalTotal > 0
        ? Number((((altTotal - originalTotal) / originalTotal) * 100).toFixed(2))
        : null;

    const reasons: string[] = [...alt.reasons.slice(0, 2)];
    if (costChangePct !== null) {
      reasons.push(
        costChangePct > 0
          ? `${costChangePct.toFixed(1)}% higher landed cost than the top recommendation.`
          : `${Math.abs(costChangePct).toFixed(1)}% lower landed cost than the top recommendation.`
      );
    }

    return {
      type,
      description: `What if you switch to ${alt.supplierName} instead?`,
      original: {
        supplierName: top.supplierName,
        landedCost: top.landedCost,
        rank: top.rank,
      },
      outcome: {
        supplierName: alt.supplierName,
        landedCost: alt.landedCost,
        costChangePct,
        reasons,
      },
      dataGaps: alt.landedCost.dataGaps,
    };
  }

  return {
    type,
    description: "Scenario type not yet implemented.",
    original: null,
    outcome: null,
    dataGaps: ["unsupportedScenarioType"],
  };
}
