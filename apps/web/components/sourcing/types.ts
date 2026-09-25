// Client-side view types for the AI Sourcing Assistant UI.
//
// Mirrors the JSON returned by /api/builder/sourcing/*. Kept separate from
// lib/sourcing/types.ts so the client bundle never imports server modules
// (which pull in Prisma and the AI SDK).

export type SourcingStage = "COLLECTING" | "NO_PRODUCT" | "NO_SUPPLIER" | "RECOMMENDED";

export type RequirementView = {
  material: string | null;
  specification: string | null;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  requiredDate: string | null;
  requiredDateText: string | null;
  brand: string | null;
  deliveryRequired: boolean | null;
  constraints: string[];
};

export type ProductMatchView = {
  productId: string;
  name: string;
  category: string;
  brand: string | null;
  grade: string | null;
  unit: string;
  confidence: number;
  stage: string;
};

/**
 * Mirrors lib/sourcing/types.ts's SourcingLocality. Disclosure only — never
 * used to hide a supplier from the comparison table. STATE means the
 * supplier's pricing region resolves (via the platform's real district/state
 * hierarchy) to the same state as the requested delivery location — e.g. a
 * "Tamilnadu" supplier IS price-applicable to an "Erode" request.
 */
export type SourcingLocalityView = "LOCAL" | "STATE" | "NON_LOCAL" | "UNKNOWN";

export type SupplierCandidateView = {
  supplierId: string;
  supplierName: string;
  location: string | null;
  locality: SourcingLocalityView;
  productId: string;
  productName: string;
  availability: "IN_STOCK" | "PARTIAL" | "UNKNOWN";
  serviceableQuantity: number | null;
  basePrice: number | null;
  unit: string;
  deliveryAvailable: boolean | null;
  estimatedDeliveryDays: number | null;
  historicalRating: number | null;
  reliabilityScore: number | null;
  specificationMatch: boolean;
  verifiedBadge: boolean;
};

export type LandedCostView = {
  quantity: number;
  unitMaterialPrice: number | null;
  materialCost: number | null;
  freightCost: number | null;
  taxAmount: number | null;
  estimatedLandedCost: number | null;
  unitLandedCost: number | null;
  dataGaps: string[];
  assumptions: string[];
};

export type OptionView = {
  supplierId: string;
  supplierName: string;
  productId: string;
  rank: number;
  recommendationScore: number;
  reasons: string[];
  dataGaps: string[];
  landedCost: LandedCostView;
  candidate: SupplierCandidateView;
};

/** A persisted recommendation (has a DB id, so it can be approved). */
export type StoredRecommendationView = {
  id: string;
  rank: number;
  supplierId: string;
  supplierName: string;
  supplierRegion: string | null;
  locality: SourcingLocalityView;
  verifiedBadge: boolean;
  productId: string | null;
  score: number;
  quantity: number;
  unit: string | null;
  unitMaterialPrice: number | null;
  freightCost: number | null;
  taxAmount: number | null;
  estimatedLandedCost: number | null;
  unitLandedCost: number | null;
  deliveryDays: number | null;
  reliabilityScore: number | null;
  specificationMatch: boolean;
  reasons: string[];
  dataGaps: string[];
};

/** Phase 8 — price intelligence decision returned by the message API. */
export type SourcingDecisionView = {
  priceIntelligence: {
    currentPrice: number | null;
    currentDate: string | null;
    averagePrice: number | null;
    vsAveragePct: number | null;
    freshness: "FRESH" | "RECENT" | "STALE" | "UNKNOWN";
    dataGaps: string[];
    /** History points for chart. Added client-side from the API response. */
    historyPoints?: Array<{ date: string; price: number; confidence: string }>;
  };
  trend: {
    direction: "RISING" | "FALLING" | "STABLE" | "VOLATILE" | "INSUFFICIENT_DATA";
    slopePctPerDay: number | null;
    periodChangePct: number | null;
    confidence: string;
    observationCount: number;
    dataGaps: string[];
  };
  forecast: {
    hasEnoughData: boolean;
    trendSlopePercent: number;
    method: string;
    points: Array<{ date: string; price: number; lower: number; upper: number }>;
  };
  confidence: {
    level: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
    score: number;
    factors: string[];
  };
  timing: {
    recommendation: "BUY_NOW" | "WAIT" | "MONITOR" | "INSUFFICIENT_DATA";
    reasons: string[];
    confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
  };
  risks: Array<{
    code: string;
    message: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
  }>;
  dataGaps: string[];
};

export type TurnResponse = {
  stage: SourcingStage;
  status: string;
  requirement: RequirementView;
  message: string;
  question: string | null;
  productMatches: ProductMatchView[];
  productAlternatives: ProductMatchView[];
  suppliers: SupplierCandidateView[];
  options: OptionView[];
  headline: string | null;
  awaitingApproval: boolean;
  /** Phase 8 — null for non-RECOMMENDED stages. */
  decision: SourcingDecisionView | null;
};

/**
 * Distinguishes an automatic, location-appropriate site selection from an
 * explicit customer override — see site-location-matcher.ts (server) for the
 * single authoritative source of this classification. The UI must render
 * these differently (§14/§19-20 of the location-aware selection change):
 *   NO_SITE          — nothing selected yet
 *   MATCHED_LOCATION — the selected site matches the requested location
 *   USER_SELECTED    — no delivery location could be determined; the
 *                      selection carries no location claim either way
 *   USER_OVERRIDE    — a location WAS requested and the selected site does
 *                      NOT match it — the customer explicitly overrode it
 */
export type SiteSelectionReason = "MATCHED_LOCATION" | "USER_SELECTED" | "USER_OVERRIDE" | "NO_SITE";

export type SessionResponse = {
  id: string;
  status: string;
  siteId: string | null;
  siteName: string | null;
  siteLocation: string | null;
  siteSelectionReason: SiteSelectionReason;
  /** The delivery location resolved from the requirement, or null when none
   * could be determined — never conflated with "no site matches". */
  requestedLocation: string | null;
  /** Active sites whose location matches `requestedLocation`. Always empty
   * when `requestedLocation` is null. */
  matchingSites: SiteChoice[];
  /** Every active site, regardless of location match — used to offer an
   * explicit "use an existing site instead" override. */
  allSites: SiteChoice[];
  requirement: RequirementView;
  conversation: Array<{ role: "user" | "assistant"; content: string; at: string }>;
  candidateProducts: ProductMatchView[];
  candidateSuppliers: SupplierCandidateView[];
  confirmedOrderId: string | null;
  confirmedAt: string | null;
  recommendations: StoredRecommendationView[];
};

/** A customer's construction Site/Project — reused from the existing Site
 * model (see components/orders/SiteSelector.tsx) for the AI ordering flow's
 * "which site is this order for?" step. Only ACTIVE sites are ever offered. */
export type SiteChoice = {
  id: string;
  name: string;
  location: string | null;
};

/** Indian-format currency. Renders a genuine "no data" marker for null. */
export function formatInr(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "Not available";
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/** Human labels for the dataGaps keys the backend emits. */
export const DATA_GAP_LABELS: Record<string, string> = {
  freight: "freight",
  deliveryCharges: "delivery charges",
  loadingUnloading: "loading/unloading",
  unitMaterialPrice: "current price",
  landedCost: "landed cost",
  deliveryDays: "delivery time",
  historicalRating: "supplier rating",
  quantity: "quantity",
};

export function describeDataGaps(gaps: string[]): string {
  return gaps.map((gap) => DATA_GAP_LABELS[gap] ?? gap).join(", ");
}

/** Human label for a supplier's locality relative to the requested delivery location. */
export function describeLocality(locality: SourcingLocalityView): string {
  switch (locality) {
    case "LOCAL":
      return "Local";
    case "STATE":
      return "Price applicable to your location";
    case "NON_LOCAL":
      return "Outside requested location";
    default:
      return "Region unknown";
  }
}

/**
 * True when a supplier is NOT confirmed local — i.e. freight to the
 * requested delivery location has not necessarily been accounted for.
 * Drives the "additional delivery/freight charges may apply" disclosure
 * (§7/§16 of the pricing-geography refinement). Deliberately NOT the same
 * question as `dataGaps.includes("freight")` on its own: a LOCAL supplier
 * with unknown freight still gets that dataGaps disclosure from the landed
 * cost breakdown, but does not need the distance-based warning below, since
 * "local" already implies the shortest/most likely-served route.
 */
export function needsFreightDisclosure(locality: SourcingLocalityView): boolean {
  return locality !== "LOCAL";
}
