/**
 * Pure derivation math for districts with no direct observations on a given
 * day (spec §5). Two independently-verifiable derivation strategies are
 * supported, and BOTH require real reference data — this module never
 * invents a number:
 *
 *   - DERIVED_INDEX: anchor district's price scaled by the ratio of the two
 *     districts' DES Building Construction Cost Index values (requires a
 *     PricingCostIndex row for both districts' desCentreCode, same/near
 *     quarter).
 *   - DERIVED_FREIGHT: anchor district's price plus a per-km freight adder,
 *     multiplied by anchorRoadDistanceKm. Requires an explicitly configured
 *     freight rate (PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT env var) — if
 *     that isn't set, this strategy is skipped rather than guessing a rate.
 *
 * If neither strategy has the data it needs, derivation returns null and the
 * caller must leave that SKU/district/day without a served price rather than
 * fabricate one. When both strategies succeed, DERIVED_BLENDED averages them.
 *
 * The optional SOR area supplement percentage (district.sorAreaSupplementPct)
 * is applied multiplicatively on top of whichever strategy result is used —
 * it is a real, source-backed uplift (Greater Chennai/Madurai/Coimbatore
 * corporation limits etc.), not a derivation strategy itself.
 */

export type DerivationMethod = "DERIVED_INDEX" | "DERIVED_FREIGHT" | "DERIVED_BLENDED";

export interface DerivationInput {
  anchorMedianPerBaseUnit: number;
  /** DES cost index value for the target district's centre, nearest quarter <= priceDate. */
  districtCostIndex?: number | null;
  /** DES cost index value for the anchor district's centre, same quarter as districtCostIndex. */
  anchorCostIndex?: number | null;
  anchorRoadDistanceKm?: number | null;
  /** From PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT — null when unconfigured. */
  freightRatePerKmPerBaseUnit?: number | null;
  sorAreaSupplementPct?: number | null;
}

export interface DerivationResult {
  value: number;
  method: DerivationMethod;
  derivationJson: Record<string, unknown>;
}

export function deriveDistrictPrice(input: DerivationInput): DerivationResult | null {
  const candidates: { value: number; method: "DERIVED_INDEX" | "DERIVED_FREIGHT"; detail: Record<string, unknown> }[] = [];

  if (
    input.districtCostIndex !== null &&
    input.districtCostIndex !== undefined &&
    input.anchorCostIndex !== null &&
    input.anchorCostIndex !== undefined &&
    input.anchorCostIndex > 0
  ) {
    const ratio = input.districtCostIndex / input.anchorCostIndex;
    candidates.push({
      value: input.anchorMedianPerBaseUnit * ratio,
      method: "DERIVED_INDEX",
      detail: { districtCostIndex: input.districtCostIndex, anchorCostIndex: input.anchorCostIndex, ratio },
    });
  }

  if (
    input.anchorRoadDistanceKm !== null &&
    input.anchorRoadDistanceKm !== undefined &&
    input.freightRatePerKmPerBaseUnit !== null &&
    input.freightRatePerKmPerBaseUnit !== undefined
  ) {
    const adder = input.anchorRoadDistanceKm * input.freightRatePerKmPerBaseUnit;
    candidates.push({
      value: input.anchorMedianPerBaseUnit + adder,
      method: "DERIVED_FREIGHT",
      detail: {
        anchorRoadDistanceKm: input.anchorRoadDistanceKm,
        freightRatePerKmPerBaseUnit: input.freightRatePerKmPerBaseUnit,
        adder,
      },
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  let value: number;
  let method: DerivationMethod;
  const detail: Record<string, unknown> = { anchorMedianPerBaseUnit: input.anchorMedianPerBaseUnit };

  if (candidates.length === 2) {
    value = (candidates[0].value + candidates[1].value) / 2;
    method = "DERIVED_BLENDED";
    detail.blendedFrom = candidates.map((c) => ({ method: c.method, value: c.value, detail: c.detail }));
  } else {
    value = candidates[0].value;
    method = candidates[0].method;
    detail[candidates[0].method] = candidates[0].detail;
  }

  if (input.sorAreaSupplementPct !== null && input.sorAreaSupplementPct !== undefined) {
    const beforeSupplement = value;
    value = value * (1 + input.sorAreaSupplementPct / 100);
    detail.sorAreaSupplementPct = input.sorAreaSupplementPct;
    detail.valueBeforeSorSupplement = beforeSupplement;
  }

  return { value, method, derivationJson: detail };
}
