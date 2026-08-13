// Strict schema validation for the structured sourcing requirement.
//
// This is the ONLY gate through which an LLM-produced (or client-supplied)
// requirement object may enter the system — §13 "each tool must have strict
// input validation" and §20 "never allow customer-provided text to directly
// become ... unrestricted tool parameters".
//
// Hand-rolled rather than zod because this repo has no zod dependency and
// `class-validator` is an apps/api-only devDependency (see apps/web's
// package.json). Written as pure functions with no imports beyond ./types so
// it runs under apps/web's existing `lib/**/*.spec.ts` vitest glob without
// any environment setup.
//
// Validation philosophy: COERCE-OR-NULL — never throw on a field the customer
// simply didn't mention, but hard-reject values that are structurally wrong
// (negative quantity, absurd magnitudes, non-string material, injected
// objects/arrays where a scalar belongs). An unparseable field becomes null,
// which downstream turns into an honest clarification question rather than a
// fabricated value.

import { EMPTY_REQUIREMENT, type SourcingRequirement, type SourcingUnit } from "./types";

/** Upper bound on any single-line quantity. Guards against absurd/typo input. */
export const MAX_QUANTITY = 1_000_000;

/** Max characters retained for any free-text requirement field. */
export const MAX_TEXT_LENGTH = 120;

/** Max number of free-text constraints retained. */
export const MAX_CONSTRAINTS = 10;

const VALID_UNITS: readonly SourcingUnit[] = [
  "bags",
  "tonnes",
  "kg",
  "pcs",
  "sqm",
  "cft",
  "brass",
  "litre",
  "nos",
];

/**
 * Canonical unit synonyms. Deliberately conservative: only unambiguous
 * mappings are listed. An unrecognised unit becomes null (-> clarification),
 * never a guess.
 */
const UNIT_SYNONYMS: Record<string, SourcingUnit> = {
  bag: "bags",
  bags: "bags",
  sack: "bags",
  sacks: "bags",
  ton: "tonnes",
  tons: "tonnes",
  tonne: "tonnes",
  tonnes: "tonnes",
  mt: "tonnes",
  "metric ton": "tonnes",
  "metric tons": "tonnes",
  "metric tonne": "tonnes",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  pc: "pcs",
  pcs: "pcs",
  piece: "pcs",
  pieces: "pcs",
  no: "nos",
  nos: "nos",
  number: "nos",
  numbers: "nos",
  unit: "nos",
  units: "nos",
  sqm: "sqm",
  "sq m": "sqm",
  "square metre": "sqm",
  "square meter": "sqm",
  "square metres": "sqm",
  "square meters": "sqm",
  cft: "cft",
  "cubic feet": "cft",
  "cubic foot": "cft",
  brass: "brass",
  litre: "litre",
  litres: "litre",
  liter: "litre",
  liters: "litre",
  ltr: "litre",
  l: "litre",
};

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT_LENGTH);
}

/**
 * Coerces a quantity to a positive finite whole number within MAX_QUANTITY.
 * Accepts "500", "1,200", 500, " 20 " — rejects 0, negatives, NaN, Infinity,
 * objects and anything above MAX_QUANTITY.
 */
export function normalizeQuantity(value: unknown): number | null {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const stripped = value.replace(/,/g, "").trim();
    if (!/^\d+(\.\d+)?$/.test(stripped)) return null;
    numeric = Number(stripped);
  } else {
    return null;
  }

  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return null;
  if (numeric > MAX_QUANTITY) return null;
  // Quantities are whole units everywhere in this platform (OrderItem.quantity
  // and CartItem.quantity are both Int), so round rather than carry a fraction
  // the order pipeline would silently truncate later.
  return Math.round(numeric);
}

/** Maps a free-text unit onto the platform vocabulary, or null if unknown. */
export function normalizeUnit(value: unknown): SourcingUnit | null {
  const text = cleanText(value);
  if (!text) return null;
  const key = text.toLowerCase().replace(/\./g, "");
  const mapped = UNIT_SYNONYMS[key];
  if (mapped) return mapped;
  return VALID_UNITS.includes(key as SourcingUnit) ? (key as SourcingUnit) : null;
}

/** Accepts only a strict yyyy-mm-dd calendar date that actually exists. */
export function normalizeIsoDate(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject roll-overs like 2026-02-31, which Date would silently accept.
  if (parsed.toISOString().slice(0, 10) !== text) return null;
  return text;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if (key === "true" || key === "yes") return true;
    if (key === "false" || key === "no") return false;
  }
  return null;
}

function normalizeConstraints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry);
    if (text && !cleaned.includes(text)) cleaned.push(text);
    if (cleaned.length >= MAX_CONSTRAINTS) break;
  }
  return cleaned;
}

/**
 * Validates/normalizes an arbitrary untrusted object into a SourcingRequirement.
 * Never throws: unknown/invalid fields collapse to null so the assistant asks
 * a question instead of proceeding on fabricated data.
 *
 * Accepts both camelCase and the snake_case aliases the spec's example JSON
 * uses (delivery_location, required_date, brand_preference, product_type), so
 * a model that echoes the documented shape validates cleanly.
 */
export function validateRequirement(input: unknown): SourcingRequirement {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...EMPTY_REQUIREMENT, constraints: [] };
  }

  const raw = input as Record<string, unknown>;

  return {
    material: cleanText(raw.material),
    specification: cleanText(raw.specification ?? raw.product_type ?? raw.productType),
    quantity: normalizeQuantity(raw.quantity),
    unit: normalizeUnit(raw.unit),
    location: cleanText(raw.location ?? raw.delivery_location ?? raw.deliveryLocation),
    requiredDate: normalizeIsoDate(raw.requiredDate ?? raw.required_date),
    requiredDateText: cleanText(raw.requiredDateText ?? raw.required_date_text),
    brand: cleanText(raw.brand ?? raw.brand_preference ?? raw.brandPreference),
    deliveryRequired: normalizeBoolean(raw.deliveryRequired ?? raw.delivery_required),
    constraints: normalizeConstraints(raw.constraints),
  };
}

/**
 * Merges a newly extracted requirement over an existing one. Later non-null
 * values win; a null from the new extraction must NEVER erase a value the
 * customer already gave in an earlier turn — otherwise the assistant would
 * re-ask questions it already has answers to, explicitly forbidden by §2.
 */
export function mergeRequirements(
  existing: SourcingRequirement,
  incoming: SourcingRequirement
): SourcingRequirement {
  return {
    material: incoming.material ?? existing.material,
    specification: incoming.specification ?? existing.specification,
    quantity: incoming.quantity ?? existing.quantity,
    unit: incoming.unit ?? existing.unit,
    location: incoming.location ?? existing.location,
    requiredDate: incoming.requiredDate ?? existing.requiredDate,
    requiredDateText: incoming.requiredDateText ?? existing.requiredDateText,
    brand: incoming.brand ?? existing.brand,
    deliveryRequired: incoming.deliveryRequired ?? existing.deliveryRequired,
    constraints: Array.from(
      new Set([...existing.constraints, ...incoming.constraints])
    ).slice(0, MAX_CONSTRAINTS),
  };
}
