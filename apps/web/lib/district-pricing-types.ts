// Shared (client + server safe) types for the Builder Product Detail Page's
// "District Price Intelligence" panel (Phase 6A). Backed by the existing
// Price Intelligence serving layer (PricingDistrictPriceDaily /
// PricingTrendMonthly / PricingDistrict), read via the new
// /api/builder/products/[canonicalProductId]/district-pricing route.
//
// Deliberately separate from lib/reports-types.ts's DistrictPriceIntelligenceRow
// (that type powers the Reports feature's multi-material table; this type
// powers a single-product panel with district selection, comparison,
// market-position and historical-purchase context). Where shapes overlap
// (trend points), field names are kept consistent so the two features don't
// drift apart for no reason.

export type DistrictPriceMethodLabel =
  | "Observed"
  | "Derived"
  | "Derived + Freight"
  | "Derived + DES Index"
  | "Manual Override";

export type DistrictPricePanelDistrictOption = {
  code: string;
  name: string;
};

export type DistrictPricePanelTrendPoint = {
  monthStart: string; // YYYY-MM-DD
  medianPerBaseUnit: number;
  momChangePct: number | null;
  yoyChangePct: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dayCount: number;
};

export type DistrictPricePanelCurrent = {
  priceDate: string; // YYYY-MM-DD
  baseUnit: string;
  displayUnit: string | null;
  medianPerBaseUnit: number;
  medianPerDisplayUnit: number | null;
  p25PerBaseUnit: number | null;
  p75PerBaseUnit: number | null;
  minPerBaseUnit: number | null;
  maxPerBaseUnit: number | null;
  observationCount: number;
  sourceCount: number;
  method: string;
  methodLabel: DistrictPriceMethodLabel;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  anchorDistrictName: string | null;
  matsrcMedianPerBaseUnit: number | null;
  freshnessLabel: string;
  isStale: boolean;
};

export type DistrictPricePanelNearbyRow = {
  districtCode: string;
  districtName: string;
  medianPerBaseUnit: number;
  minPerBaseUnit: number | null;
  maxPerBaseUnit: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  method: string;
  methodLabel: DistrictPriceMethodLabel;
  priceDate: string;
  diffPct: number | null;
};

export type DistrictPricePanelSourceBreakdownEntry = {
  tier: "GOVERNMENT" | "MANUFACTURER" | "AGGREGATOR" | "MARKETPLACE" | "INTERNAL";
  label: string;
  sourceCount: number;
  attributionText: string | null;
};

export type DistrictPricePanelMarketPosition = {
  status: "BELOW" | "WITHIN" | "ABOVE";
  diffPct: number;
} | null;

export type DistrictPricePanelHistoricalPurchase = {
  previousPrice: number;
  previousDate: string;
  currentMedianPerDisplayUnit: number | null;
  diffAmount: number | null;
  diffPct: number | null;
} | null;

export type DistrictPricePanelEmptyReason =
  | "NO_SKU_MATCH"
  | "NO_DISTRICT_DATA"
  | "NO_TREND_DATA"
  | "NO_COMPARISON_DATA";

export type DistrictPricingPanelResponse = {
  resolved: boolean;
  emptyReason?: DistrictPricePanelEmptyReason;
  selectedDistrict: DistrictPricePanelDistrictOption | null;
  isDistrictFallback: boolean;
  availableDistricts: DistrictPricePanelDistrictOption[];
  current: DistrictPricePanelCurrent | null;
  trend: DistrictPricePanelTrendPoint[];
  nearbyDistricts: DistrictPricePanelNearbyRow[];
  sourceBreakdown: DistrictPricePanelSourceBreakdownEntry[];
  marketPosition: DistrictPricePanelMarketPosition;
  marketPositionUnavailableReason: "LOW_CONFIDENCE" | "UNIT_MISMATCH" | "NO_DATA" | null;
  historicalPurchase: DistrictPricePanelHistoricalPurchase;
};
