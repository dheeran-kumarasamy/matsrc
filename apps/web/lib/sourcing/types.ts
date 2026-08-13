// Shared types for the AI Sourcing Assistant (M12).
//
// Customer-facing positioning: "Tell us what material you need. Our AI
// Sourcing Assistant will help you find the best sourcing option."
//
// This module is intentionally type-only + pure-constant: every runtime
// module in lib/sourcing/* imports its shapes from here so the Json columns
// on SourcingSession/SourcingRecommendation have exactly one owning
// definition (see the schema comments on those models).
//
// HARD RULE reflected throughout these types: any field the platform may not
// actually have is `| null` and is accompanied by a `dataGaps` entry. A null
// must be surfaced to the customer as "I don't currently have verified data
// for this" — never coerced to 0 and never guessed by the LLM.

/** Units the assistant recognises, normalized to the platform's vocabulary. */
export type SourcingUnit =
  | "bags"
  | "tonnes"
  | "kg"
  | "pcs"
  | "sqm"
  | "cft"
  | "brass"
  | "litre"
  | "nos";

/**
 * Structured sourcing requirement — the output of Capability A (§4) and the
 * validated shape stored in SourcingSession.requirementJson.
 */
export type SourcingRequirement = {
  /** Broad material family, e.g. "Cement", "TMT steel". */
  material: string | null;
  /** Product type / grade / spec, e.g. "PPC", "12mm", "Fe500D". */
  specification: string | null;
  quantity: number | null;
  unit: SourcingUnit | null;
  /** Free-text delivery place name as the customer said it, e.g. "Erode". */
  location: string | null;
  /** ISO date (yyyy-mm-dd) when resolvable, else null. */
  requiredDate: string | null;
  /** Relative phrase the customer used ("next week"), retained for disclosure. */
  requiredDateText: string | null;
  brand: string | null;
  deliveryRequired: boolean | null;
  /** Any other constraint the customer stated verbatim. */
  constraints: string[];
};

export const EMPTY_REQUIREMENT: SourcingRequirement = {
  material: null,
  specification: null,
  quantity: null,
  unit: null,
  location: null,
  requiredDate: null,
  requiredDateText: null,
  brand: null,
  deliveryRequired: null,
  constraints: [],
};

/**
 * Fields that MUST be known before any supplier search runs. Anything not in
 * this list must never trigger a clarification question (§2: "Do not ask
 * unnecessary questions when sufficient information is already available").
 *
 * `brand` is deliberately excluded — a customer with no brand preference is a
 * complete requirement, not an incomplete one.
 */
export const REQUIRED_REQUIREMENT_FIELDS = [
  "material",
  "quantity",
  "unit",
  "location",
] as const;

export type RequiredRequirementField = (typeof REQUIRED_REQUIREMENT_FIELDS)[number];

/** A catalogue product the requirement was matched to. */
export type SourcingProductMatch = {
  /** Product.id (the supplier listing). */
  productId: string;
  /** CanonicalProduct.id when the listing is part of a cross-supplier group. */
  canonicalProductId: string | null;
  name: string;
  category: string;
  brand: string | null;
  grade: string | null;
  unit: string;
  /** 0-1 match confidence from the deterministic matcher. */
  confidence: number;
  /** Which matcher stage produced it — so "possible match" stays honest. */
  stage: "exact" | "fuzzy" | "category";
};

export type ProductSearchOutcome = {
  /** True only when at least one match cleared the confident threshold. */
  confident: boolean;
  matches: SourcingProductMatch[];
  /** Set instead of confident matches when the assistant must ask (§5, §24). */
  needsClarification: boolean;
  /** Close-but-not-confident options to offer, e.g. 10mm/16mm for a 12mm ask. */
  alternatives: SourcingProductMatch[];
};

/**
 * A candidate supplier for the requirement. Every field here comes from the
 * database / live listings feed — nothing is inferred.
 */
export type SourcingSupplierCandidate = {
  supplierId: string;
  supplierName: string;
  /** SupplierProfile.region — null when the supplier hasn't set one. */
  location: string | null;
  productId: string;
  productName: string;
  /** Availability derived from stock/maxServiceableQty only. */
  availability: "IN_STOCK" | "PARTIAL" | "UNKNOWN";
  /** Units the supplier can actually serve, when known. */
  serviceableQuantity: number | null;
  /** Effective unit price for the requested quantity (tier-resolved). */
  basePrice: number | null;
  unit: string;
  minimumOrderQuantity: number | null;
  /** Null = platform has no verified delivery-capability data. */
  deliveryAvailable: boolean | null;
  estimatedDeliveryDays: number | null;
  /** Mean of SupplierRating delivery+quality, 0-5. Null when never rated. */
  historicalRating: number | null;
  /** historicalRating expressed 0-100. Null when never rated. */
  reliabilityScore: number | null;
  /** Does the listing match the requested brand/spec exactly? */
  specificationMatch: boolean;
  verifiedBadge: boolean;
};

/** Deterministic landed-cost breakdown (§7). Never computed by the LLM. */
export type LandedCostBreakdown = {
  quantity: number;
  unitMaterialPrice: number | null;
  materialCost: number | null;
  freightCost: number | null;
  deliveryCharges: number | null;
  handlingCharges: number | null;
  taxAmount: number | null;
  estimatedLandedCost: number | null;
  unitLandedCost: number | null;
  /** Which inputs were unavailable, e.g. ["freight"]. Drives disclosure. */
  dataGaps: string[];
  /** Named assumptions applied, e.g. ["taxRatePercent=18 (platform default)"]. */
  assumptions: string[];
};

/** A ranked, explainable sourcing option (§8). */
export type RankedSupplierOption = {
  supplierId: string;
  supplierName: string;
  productId: string;
  rank: number;
  /** 0-100 transparent score. */
  recommendationScore: number;
  reasons: string[];
  dataGaps: string[];
  landedCost: LandedCostBreakdown;
  candidate: SourcingSupplierCandidate;
};

/** One turn of the assistant transcript (SourcingSession.conversationJson). */
export type SourcingTurn = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

/** Names of the tools that actually exist. Nothing else is invocable. */
export const SOURCING_TOOLS = [
  "parse_requirement",
  "search_products",
  "find_suppliers",
  "get_current_prices",
  "calculate_landed_cost",
  "rank_suppliers",
  "get_sourcing_status",
  "confirm_recommendation",
] as const;

export type SourcingToolName = (typeof SOURCING_TOOLS)[number];
