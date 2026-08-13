// `calculate_landed_cost` — deterministic landed-cost calculation (§7).
//
// MANDATORY SEPARATION (§23): every number produced here is computed by this
// module, never by the LLM. The assistant receives this breakdown and explains
// it in words; it must not recompute, round or "adjust" any figure.
//
// Formula:
//   materialCost = unitMaterialPrice * quantity
//   subtotal     = materialCost + freight + deliveryCharges + handlingCharges
//   taxAmount    = subtotal * taxRatePercent / 100
//   landedCost   = subtotal + taxAmount
//
// MISSING-DATA RULE: an unavailable input is NEVER silently treated as zero.
//   - If unitMaterialPrice is unavailable there is no landed cost at all
//     (returns nulls + a "unitMaterialPrice" data gap) — the assistant must
//     then say pricing is unavailable and offer to request quotations, which
//     is the §24 "Price unavailable" behaviour.
//   - If freight is unavailable it is recorded in `dataGaps` and EXCLUDED from
//     the total, and the caller must disclose that the total excludes freight.
//     It is never guessed.
//
// Rounding: currency values are rounded to 2 decimals at the END of the
// calculation only (never intermediate), matching the Decimal(14,2) columns
// these values are persisted into.

import type { LandedCostBreakdown } from "./types";

/**
 * Default GST rate applied when the product carries no explicit
 * taxRatePercent. Mirrors the existing convention in the site-wise report /
 * Tally export path, where OrderItem.taxRatePercent is nullable and falls back
 * to a configurable default rate at report/export time.
 */
export const DEFAULT_TAX_RATE_PERCENT = 18;

/** Rounds to 2 decimal places without floating-point drift. */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeOptional(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export type LandedCostInput = {
  quantity: number;
  /** Tier-resolved unit price. Null when the platform has no current price. */
  unitMaterialPrice: number | null;
  /** Total freight for the consignment (not per unit). Null when unknown. */
  freightCost?: number | null;
  /** Explicit delivery/last-mile charge, when the supplier states one. */
  deliveryCharges?: number | null;
  /** Loading/unloading/handling charge, when the supplier states one. */
  handlingCharges?: number | null;
  /**
   * GST percent for this product. Null/undefined applies
   * DEFAULT_TAX_RATE_PERCENT and records the assumption.
   */
  taxRatePercent?: number | null;
  /**
   * When false, tax is deliberately excluded from the total (e.g. comparing
   * pre-tax landed costs). Recorded as an assumption.
   */
  includeTax?: boolean;
};

/**
 * Computes the estimated landed cost for one supplier option.
 *
 * Returns a fully-populated breakdown where every unavailable input is both
 * null AND listed in `dataGaps`, so no caller can mistake "no data" for zero.
 */
export function calculateLandedCost(input: LandedCostInput): LandedCostBreakdown {
  const dataGaps: string[] = [];
  const assumptions: string[] = [];

  const quantity =
    Number.isFinite(input.quantity) && input.quantity > 0 ? Math.round(input.quantity) : 0;
  if (quantity === 0) dataGaps.push("quantity");

  const unitMaterialPrice =
    typeof input.unitMaterialPrice === "number" && Number.isFinite(input.unitMaterialPrice)
      ? input.unitMaterialPrice
      : null;
  if (unitMaterialPrice === null) dataGaps.push("unitMaterialPrice");

  // No verified unit price -> no landed cost. Returning zero here would be a
  // fabricated ₹0 quote, which §29 explicitly forbids.
  if (unitMaterialPrice === null || quantity === 0) {
    return {
      quantity,
      unitMaterialPrice,
      materialCost: null,
      freightCost: normalizeOptional(input.freightCost),
      deliveryCharges: normalizeOptional(input.deliveryCharges),
      handlingCharges: normalizeOptional(input.handlingCharges),
      taxAmount: null,
      estimatedLandedCost: null,
      unitLandedCost: null,
      dataGaps,
      assumptions,
    };
  }

  const materialCost = unitMaterialPrice * quantity;

  const freightCost = normalizeOptional(input.freightCost);
  if (freightCost === null) dataGaps.push("freight");

  const deliveryCharges = normalizeOptional(input.deliveryCharges);
  if (deliveryCharges === null) dataGaps.push("deliveryCharges");

  const handlingCharges = normalizeOptional(input.handlingCharges);
  if (handlingCharges === null) dataGaps.push("loadingUnloading");

  // Unavailable components are EXCLUDED from the subtotal (not zero-filled).
  // The dataGaps entries above are what the UI/assistant uses to disclose that
  // the estimate is partial.
  const subtotal =
    materialCost + (freightCost ?? 0) + (deliveryCharges ?? 0) + (handlingCharges ?? 0);

  const includeTax = input.includeTax !== false;

  let taxRatePercent: number | null = null;
  if (includeTax) {
    if (typeof input.taxRatePercent === "number" && Number.isFinite(input.taxRatePercent)) {
      taxRatePercent = input.taxRatePercent;
    } else {
      taxRatePercent = DEFAULT_TAX_RATE_PERCENT;
      assumptions.push(`taxRatePercent=${DEFAULT_TAX_RATE_PERCENT} (platform default)`);
    }
  } else {
    assumptions.push("tax excluded from comparison");
  }

  const taxAmount = taxRatePercent === null ? null : (subtotal * taxRatePercent) / 100;
  const estimatedLandedCost = subtotal + (taxAmount ?? 0);

  return {
    quantity,
    unitMaterialPrice: roundCurrency(unitMaterialPrice),
    materialCost: roundCurrency(materialCost),
    freightCost: freightCost === null ? null : roundCurrency(freightCost),
    deliveryCharges: deliveryCharges === null ? null : roundCurrency(deliveryCharges),
    handlingCharges: handlingCharges === null ? null : roundCurrency(handlingCharges),
    taxAmount: taxAmount === null ? null : roundCurrency(taxAmount),
    estimatedLandedCost: roundCurrency(estimatedLandedCost),
    unitLandedCost: roundCurrency(estimatedLandedCost / quantity),
    dataGaps,
    assumptions,
  };
}

/**
 * True when the breakdown is complete enough to compare against other
 * suppliers on a like-for-like basis. A total that silently omits freight is
 * NOT comparable, and the caller must disclose that rather than rank on it as
 * though it were final.
 */
export function isComparableLandedCost(breakdown: LandedCostBreakdown): boolean {
  return breakdown.estimatedLandedCost !== null && !breakdown.dataGaps.includes("freight");
}
