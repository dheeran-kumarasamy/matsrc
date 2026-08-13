// Deterministic, rule-based sourcing-requirement extractor.
//
// ROLE (important): this is NOT a replacement for the LLM. Natural-language
// understanding is the LLM's job (§23). This module exists for exactly two
// reasons, both mandated by the spec:
//
//   1. §24 "AI/API failure — the application must remain usable". When no AI
//      provider is configured or the provider call fails, the assistant still
//      makes forward progress on the common, well-formed phrasings instead of
//      returning a dead end.
//   2. §25 requirement-extraction tests need a deterministic assertion target
//      that doesn't hit a paid external API in CI.
//
// It is deliberately CONSERVATIVE: it only extracts what it can see literally
// in the text. Anything it cannot find stays null, which produces an honest
// clarification question. It never infers a brand, never invents a spec and
// never assumes a quantity.

import { validateRequirement } from "./requirement-schema";
import {
  EMPTY_REQUIREMENT,
  REQUIRED_REQUIREMENT_FIELDS,
  type RequiredRequirementField,
  type SourcingRequirement,
} from "./types";

/**
 * Known material families and the phrases that indicate them. Ordered
 * longest-phrase-first at match time so "tmt steel" wins over "steel".
 *
 * Kept intentionally small and construction-specific — these are material
 * FAMILIES for requirement extraction only. Actual catalogue matching is done
 * against real Product/Category rows by product-search.ts; nothing here
 * asserts that a material exists in the catalogue.
 */
const MATERIAL_PATTERNS: Array<{ material: string; phrases: string[] }> = [
  { material: "TMT steel", phrases: ["tmt steel", "tmt bar", "tmt bars", "tmt rod", "tmt rods", "tmt", "rebar", "steel rod", "steel rods", "reinforcement steel"] },
  { material: "Cement", phrases: ["cement", "opc", "ppc", "psc"] },
  { material: "AAC blocks", phrases: ["aac block", "aac blocks", "aac"] },
  { material: "Concrete blocks", phrases: ["concrete block", "concrete blocks", "solid block", "solid blocks", "hollow block", "hollow blocks"] },
  { material: "Bricks", phrases: ["brick", "bricks", "red brick", "red bricks", "fly ash brick", "fly ash bricks"] },
  { material: "M-Sand", phrases: ["m sand", "m-sand", "manufactured sand"] },
  { material: "P-Sand", phrases: ["p sand", "p-sand", "plastering sand"] },
  { material: "River sand", phrases: ["river sand"] },
  { material: "Sand", phrases: ["sand"] },
  { material: "Aggregate", phrases: ["aggregate", "aggregates", "jelly", "blue metal", "metal jelly"] },
  { material: "RMC", phrases: ["ready mix concrete", "ready-mix concrete", "rmc"] },
  { material: "Tiles", phrases: ["tile", "tiles", "vitrified tile", "vitrified tiles"] },
  { material: "Paint", phrases: ["paint", "primer", "emulsion"] },
  { material: "Plywood", phrases: ["plywood", "ply board", "ply"] },
  { material: "Pipes", phrases: ["pvc pipe", "pvc pipes", "cpvc pipe", "cpvc pipes", "pipe", "pipes"] },
];

/**
 * Cement product types. These are *specifications*, not materials — "PPC
 * cement" yields material=Cement, specification=PPC.
 */
const CEMENT_TYPES = ["ppc", "opc", "psc", "opc 53", "opc 43", "opc53", "opc43"];

/** Steel grade specs, e.g. Fe500D. */
const STEEL_GRADE_PATTERN = /\bfe\s?-?\s?(415|500|550)\s?(d|s)?\b/i;

/** Size spec, e.g. "12mm", "12 mm", "12 millimeter", "8 mm". */
const SIZE_PATTERN = /\b(\d{1,3}(?:\.\d+)?)\s*(mm|millimeter|millimetre|millimeters|millimetres|cm|inch|inches|")\b/i;

/**
 * Quantity + unit, e.g. "500 bags", "20 tonnes", "10,000 AAC blocks",
 * "1200 sq m". The unit alternatives are ordered longest-first so
 * "metric tons" is not partially matched as "metric".
 */
const QUANTITY_PATTERN = new RegExp(
  String.raw`\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*` +
    String.raw`(metric tonnes|metric tonne|metric tons|metric ton|square metres|square meters|square metre|square meter|cubic feet|cubic foot|` +
    String.raw`tonnes|tonne|tons|ton|bags|bag|sacks|sack|kgs|kg|kilograms|kilogram|pcs|pc|pieces|piece|nos|no|units|unit|` +
    String.raw`sqm|sq m|cft|brass|litres|litre|liters|liter|ltr)\b`,
  "i"
);

/** Bare quantity followed by a material noun that implies a countable unit. */
const COUNTABLE_MATERIALS = ["block", "blocks", "brick", "bricks", "tile", "tiles", "pipe", "pipes", "sheet", "sheets"];

/** Phrases that explicitly request delivery. */
const DELIVERY_PHRASES = ["deliver", "delivered", "delivery", "to site", "at site", "shipped", "transport"];

/** Phrases that explicitly decline delivery (self pickup). */
const PICKUP_PHRASES = ["pickup", "pick up", "ex-works", "ex works", "self collect", "self-collect", "collect myself"];

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractMaterial(lower: string): string | null {
  let best: { material: string; length: number } | null = null;
  for (const entry of MATERIAL_PATTERNS) {
    for (const phrase of entry.phrases) {
      if (!new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) continue;
      if (!best || phrase.length > best.length) {
        best = { material: entry.material, length: phrase.length };
      }
    }
  }
  return best?.material ?? null;
}

/**
 * Extracts the product specification: a size (12mm), a steel grade (Fe500D)
 * or a cement type (PPC). Returns the size+grade combined when both are
 * present, since both are needed to identify the SKU.
 */
function extractSpecification(lower: string, material: string | null): string | null {
  const parts: string[] = [];

  const size = lower.match(SIZE_PATTERN);
  if (size) {
    const value = size[1];
    const rawUnit = size[2].toLowerCase();
    // Normalize every millimetre spelling to "mm" so "12 millimeter steel rod"
    // and "12mm TMT" produce the identical specification string (§25 synonym
    // requirement).
    const unit = rawUnit.startsWith("milli") ? "mm" : rawUnit === '"' || rawUnit.startsWith("inch") ? "inch" : rawUnit;
    parts.push(`${value}${unit === "inch" ? " inch" : unit}`);
  }

  const grade = lower.match(STEEL_GRADE_PATTERN);
  if (grade) {
    parts.push(`Fe${grade[1]}${grade[2] ? grade[2].toUpperCase() : ""}`);
  }

  if (material === "Cement") {
    for (const type of CEMENT_TYPES) {
      if (new RegExp(`\\b${type}\\b`).test(lower)) {
        parts.push(type.toUpperCase().replace(/\s+/g, " "));
        break;
      }
    }
  }

  if (parts.length === 0) return null;
  return parts.join(" ");
}

function extractQuantityAndUnit(lower: string): { quantity: string | null; unit: string | null } {
  const explicit = lower.match(QUANTITY_PATTERN);
  if (explicit) {
    return { quantity: explicit[1], unit: explicit[2] };
  }

  // "10,000 AAC blocks" / "5000 bricks" — a countable material noun implies
  // pieces. Only applied when the noun is unambiguously countable.
  const countable = lower.match(
    new RegExp(String.raw`\b(\d{1,3}(?:,\d{3})+|\d+)\s+(?:[a-z-]+\s+){0,2}(${COUNTABLE_MATERIALS.join("|")})\b`)
  );
  if (countable) {
    return { quantity: countable[1], unit: "nos" };
  }

  return { quantity: null, unit: null };
}

/**
 * Extracts the delivery place name. Uses preposition anchors ("to", "near",
 * "at", "in") and reads the ORIGINAL-cased text so a proper noun keeps its
 * capitalisation ("Erode", not "erode").
 *
 * When `knownLocations` is supplied (real district/city names from the
 * platform), a candidate is only accepted if it appears in that list OR the
 * preposition anchor was explicit — this keeps "I need cement in bulk" from
 * being read as a place called "bulk".
 */
function extractLocation(original: string, knownLocations?: string[]): string | null {
  const known = (knownLocations ?? []).map((entry) => entry.toLowerCase());

  const anchored = original.match(
    /\b(?:delivered to|deliver to|delivery to|shipped to|to|near|around|at|in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/
  );
  if (anchored) {
    const candidate = anchored[1].trim();
    const lowerCandidate = candidate.toLowerCase();
    // Reject anchors that captured a following clause rather than a place.
    const STOPWORDS = ["I", "We", "My", "Our", "The", "Next", "Tomorrow", "Today", "Delivery", "Site"];
    if (!STOPWORDS.includes(candidate.split(" ")[0])) {
      if (known.length === 0 || known.includes(lowerCandidate)) return candidate;
      // Unknown-but-anchored place names are still accepted: the platform's
      // district list is not exhaustive of every delivery point a customer
      // may name, and supplier-search will simply find nothing rather than
      // fabricate a match.
      return candidate;
    }
  }

  // Fall back to a bare mention of a known location anywhere in the text.
  for (const entry of knownLocations ?? []) {
    if (new RegExp(`\\b${entry.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(original.toLowerCase())) {
      return entry;
    }
  }

  return null;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolves a relative date phrase against `now`.
 *
 * Returns BOTH the derived ISO date and the phrase the customer used. The
 * phrase is retained so the assistant can confirm rather than silently commit
 * the customer to a date it inferred ("next week" -> "I've taken this as
 * 2026-08-19 — is that right?"), which is the §2 "derived/confirmed date"
 * requirement.
 */
export function resolveRelativeDate(
  lower: string,
  now: Date
): { requiredDate: string | null; requiredDateText: string | null } {
  const explicitIso = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicitIso) {
    return { requiredDate: explicitIso[1], requiredDateText: explicitIso[1] };
  }

  const addDays = (days: number) => {
    const next = new Date(now.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return toIsoDate(next);
  };

  if (/\btoday\b/.test(lower)) return { requiredDate: addDays(0), requiredDateText: "today" };
  if (/\btomorrow\b/.test(lower)) return { requiredDate: addDays(1), requiredDateText: "tomorrow" };
  if (/\bday after tomorrow\b/.test(lower)) {
    return { requiredDate: addDays(2), requiredDateText: "day after tomorrow" };
  }
  if (/\bthis week\b/.test(lower)) return { requiredDate: addDays(3), requiredDateText: "this week" };
  if (/\bnext week\b/.test(lower)) return { requiredDate: addDays(7), requiredDateText: "next week" };
  if (/\bnext month\b/.test(lower)) return { requiredDate: addDays(30), requiredDateText: "next month" };

  const inDays = lower.match(/\bin (\d{1,3}) days?\b/);
  if (inDays) {
    return { requiredDate: addDays(Number(inDays[1])), requiredDateText: `in ${inDays[1]} days` };
  }

  const inWeeks = lower.match(/\bin (\d{1,2}) weeks?\b/);
  if (inWeeks) {
    return {
      requiredDate: addDays(Number(inWeeks[1]) * 7),
      requiredDateText: `in ${inWeeks[1]} weeks`,
    };
  }

  if (/\burgent\b|\bimmediately\b|\basap\b/.test(lower)) {
    return { requiredDate: addDays(0), requiredDateText: "urgent" };
  }

  return { requiredDate: null, requiredDateText: null };
}

function extractDeliveryRequired(lower: string): boolean | null {
  if (PICKUP_PHRASES.some((phrase) => lower.includes(phrase))) return false;
  if (DELIVERY_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  return null;
}

export type ExtractOptions = {
  /** Injected for deterministic tests; defaults to the real clock. */
  now?: Date;
  /** Real place names from the platform, used to validate a location guess. */
  knownLocations?: string[];
  /** Real brand names (Brand master data). A brand is NEVER guessed. */
  knownBrands?: string[];
};

/**
 * Extracts a brand ONLY by exact match against real Brand master-data names.
 * There is no heuristic brand detection: inventing a brand preference the
 * customer never expressed would corrupt the sourcing filter.
 */
function extractBrand(lower: string, knownBrands?: string[]): string | null {
  for (const brand of knownBrands ?? []) {
    const normalized = brand.toLowerCase().trim();
    if (!normalized) continue;
    if (new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) {
      return brand;
    }
  }
  return null;
}

/**
 * Rule-based extraction of a sourcing requirement from free text.
 *
 * Always returns a schema-validated SourcingRequirement. Fields that could not
 * be found literally in the text are null — the caller turns those into the
 * minimum necessary clarification questions.
 */
export function extractRequirementDeterministic(
  input: string,
  options: ExtractOptions = {}
): SourcingRequirement {
  if (typeof input !== "string" || !input.trim()) {
    return { ...EMPTY_REQUIREMENT, constraints: [] };
  }

  const original = input.trim();
  const lower = normalizeText(original);
  const now = options.now ?? new Date();

  const material = extractMaterial(lower);
  const { quantity, unit } = extractQuantityAndUnit(lower);
  const { requiredDate, requiredDateText } = resolveRelativeDate(lower, now);

  return validateRequirement({
    material,
    specification: extractSpecification(lower, material),
    quantity,
    unit,
    location: extractLocation(original, options.knownLocations),
    requiredDate,
    requiredDateText,
    brand: extractBrand(lower, options.knownBrands),
    deliveryRequired: extractDeliveryRequired(lower),
    constraints: [],
  });
}

/**
 * Returns the sourcing-critical fields that are still missing. Only fields in
 * REQUIRED_REQUIREMENT_FIELDS are ever reported, which is what enforces §2's
 * "ask follow-up questions ONLY when information necessary for sourcing is
 * missing".
 */
export function missingRequirementFields(
  requirement: SourcingRequirement
): RequiredRequirementField[] {
  return REQUIRED_REQUIREMENT_FIELDS.filter((field) => {
    const value = requirement[field];
    return value === null || value === undefined || value === "";
  });
}

/** True when the requirement has everything needed to start sourcing. */
export function isRequirementComplete(requirement: SourcingRequirement): boolean {
  return missingRequirementFields(requirement).length === 0;
}

/**
 * The single question to ask next, phrased per the §2 examples. Returns null
 * when nothing necessary is missing — the assistant must then proceed to
 * search rather than pad the conversation with optional questions.
 */
export function nextClarificationQuestion(requirement: SourcingRequirement): string | null {
  const missing = missingRequirementFields(requirement);
  if (missing.length === 0) return null;

  switch (missing[0]) {
    case "material":
      return "What material are you looking for?";
    case "quantity":
      return requirement.material
        ? `How much ${requirement.material.toLowerCase()} do you need?`
        : "What quantity do you need?";
    case "unit":
      return "What unit is that in (for example bags, tonnes or pieces)?";
    case "location":
      return "Where should this be delivered?";
    default:
      return null;
  }
}
