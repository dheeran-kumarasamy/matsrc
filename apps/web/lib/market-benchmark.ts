// market-benchmark.ts — P2-A (Market Benchmark / "vs. market").
//
// Pure, DB-free domain logic that decides whether the report's own price can
// be honestly compared against the canonical Matsrc market reference price
// (resolved via PricingResolutionService's DISTRICT > STATE > NATIONAL
// hierarchy — see lib/sourcing/price-lookup.ts's getMarketReferencePrice(),
// which already wraps that service and is reused here unchanged, not
// duplicated).
//
// MANDATORY RULES enforced here:
//   1. Never compare unlike units. A reportUnit/referenceUnit mismatch is
//      only bridged when the caller supplies a genuine conversion factor it
//      looked up from PricingUnitConversion (materialCategoryId-scoped) —
//      this module never invents or guesses a factor.
//   2. Never compare a material-only reference against a landed cost. The
//      caller must only ever pass a material-only comparisonPrice.
//   3. Never fabricate a benchmark when data is missing/incompatible —
//      `available: false` with an honest `unavailableReason` instead.
//   4. STATE/NATIONAL fallback is always labelled as such, never presented
//      as district-level precision.
//
// Tolerance for BELOW/AT/ABOVE MARKET reuses the same ±5% band already
// established as this codebase's convention for "no P25/P75 spread
// available" cases (see lib/district-pricing.ts's computeMarketPosition —
// the Price Intelligence panel's fallback tolerance), rather than inventing
// a new threshold for this feature.
const TOLERANCE_PERCENT = 5;

export type MarketReferenceInput = {
  price: number;
  /** BaseUnit/displayUnit string as returned by PricingResolutionService, e.g. "BAG", "KG". */
  unit: string;
  geographyLevel: "DISTRICT" | "STATE" | "NATIONAL";
  district: string | null;
  state: string | null;
  asOf: string;
  isStale: boolean;
  fallbackUsed: boolean;
};

export type MarketBenchmarkInput = {
  /** The report's own material-only unit, e.g. Product.unit ("BAG", "MT"). Never a landed-cost unit. */
  reportUnit: string;
  /** The material-only comparison price, in reportUnit terms (e.g. offer.basePrice). Never a landed cost. */
  comparisonPrice: number;
  /** Null when PricingResolutionService returned NO_DATA (or the lookup failed soft). */
  reference: MarketReferenceInput | null;
  /**
   * A genuine, DB-verified factor to convert one reportUnit into one
   * referenceUnit (e.g. 1 MT -> 1000 KG, factor = 1000), looked up by the
   * caller from PricingUnitConversion for this SKU's materialCategoryId.
   * Null when reportUnit === reference.unit (no conversion needed) or when
   * no verified conversion exists (comparison must then be marked
   * unavailable — never guessed).
   */
  unitConversionFactorToReferenceUnit?: number | null;
};

export type MarketComparisonStatus = "BELOW_MARKET" | "AT_MARKET" | "ABOVE_MARKET";

export type MarketBenchmarkUnavailableReason =
  | "NO_REFERENCE_DATA"
  | "UNIT_INCOMPATIBLE";

export type MarketBenchmarkResult =
  | {
      available: true;
      referencePrice: number;
      referenceUnit: string;
      referenceLevel: "DISTRICT" | "STATE" | "NATIONAL";
      locationLabel: string;
      asOf: string;
      isStale: boolean;
      fallbackUsed: boolean;
      comparisonPrice: number;
      differenceAbsolute: number;
      differencePercent: number;
      comparisonStatus: MarketComparisonStatus;
    }
  | {
      available: false;
      unavailableReason: MarketBenchmarkUnavailableReason;
    };

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

function locationLabelFor(reference: MarketReferenceInput): string {
  if (reference.geographyLevel === "DISTRICT" && reference.district) return reference.district;
  if (reference.geographyLevel === "STATE" && reference.state) return reference.state;
  if (reference.geographyLevel === "NATIONAL") return "India";
  // Defensive fallback — should not normally happen given the resolution
  // service's contract, but never silently claim a location we don't have.
  return reference.district || reference.state || "Unknown location";
}

/**
 * Determines whether a valid, honest market comparison can be made, and if
 * so, computes it. Returns an explicit unavailable state (never a fabricated
 * ₹0/0%/"at market") whenever the reference is missing or the unit basis
 * cannot be reconciled.
 */
export function computeMarketBenchmark(input: MarketBenchmarkInput): MarketBenchmarkResult {
  const { reportUnit, comparisonPrice, reference, unitConversionFactorToReferenceUnit } = input;

  if (!reference) {
    return { available: false, unavailableReason: "NO_REFERENCE_DATA" };
  }

  const sameUnit = normalizeUnit(reportUnit) === normalizeUnit(reference.unit);
  let comparablePrice: number | null = null;

  if (sameUnit) {
    comparablePrice = comparisonPrice;
  } else if (
    typeof unitConversionFactorToReferenceUnit === "number" &&
    Number.isFinite(unitConversionFactorToReferenceUnit) &&
    unitConversionFactorToReferenceUnit > 0
  ) {
    // factor converts 1 reportUnit -> N referenceUnit-base-units (e.g. 1 MT
    // -> 1000 KG). Price per reportUnit / factor = price per referenceUnit.
    comparablePrice = comparisonPrice / unitConversionFactorToReferenceUnit;
  }

  if (comparablePrice === null) {
    return { available: false, unavailableReason: "UNIT_INCOMPATIBLE" };
  }

  const differenceAbsolute = comparablePrice - reference.price;
  const differencePercent =
    reference.price > 0 ? (differenceAbsolute / reference.price) * 100 : 0;

  let comparisonStatus: MarketComparisonStatus;
  if (differencePercent < -TOLERANCE_PERCENT) comparisonStatus = "BELOW_MARKET";
  else if (differencePercent > TOLERANCE_PERCENT) comparisonStatus = "ABOVE_MARKET";
  else comparisonStatus = "AT_MARKET";

  return {
    available: true,
    referencePrice: reference.price,
    referenceUnit: reference.unit,
    referenceLevel: reference.geographyLevel,
    locationLabel: locationLabelFor(reference),
    asOf: reference.asOf,
    isStale: reference.isStale,
    fallbackUsed: reference.fallbackUsed,
    comparisonPrice: comparablePrice,
    differenceAbsolute,
    differencePercent,
    comparisonStatus,
  };
}
