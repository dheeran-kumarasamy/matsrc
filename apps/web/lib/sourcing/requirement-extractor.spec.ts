// §25 "Requirement extraction" tests for the AI Sourcing Assistant.
//
// These assert the DETERMINISTIC extractor, not the LLM — CI must never call a
// paid external API, and the deterministic path is also the live AI-failure
// fallback, so it genuinely needs this coverage.

import { describe, expect, it } from "vitest";

import {
  extractRequirementDeterministic,
  isRequirementComplete,
  missingRequirementFields,
  nextClarificationQuestion,
} from "./requirement-extractor";
import { mergeRequirements, validateRequirement } from "./requirement-schema";
import { EMPTY_REQUIREMENT } from "./types";

// Fixed clock so "next week" is a stable assertion.
const NOW = new Date("2026-08-12T00:00:00.000Z");

describe("extractRequirementDeterministic — the spec's canonical example", () => {
  it("extracts the full requirement from '500 bags of PPC cement delivered to Erode next week'", () => {
    const result = extractRequirementDeterministic(
      "I need 500 bags of PPC cement delivered to Erode next week.",
      { now: NOW }
    );

    expect(result.material).toBe("Cement");
    expect(result.specification).toBe("PPC");
    expect(result.quantity).toBe(500);
    expect(result.unit).toBe("bags");
    expect(result.location).toBe("Erode");
    expect(result.deliveryRequired).toBe(true);
    // "next week" -> derived date, with the original phrase retained so the
    // assistant confirms rather than silently commits the customer.
    expect(result.requiredDate).toBe("2026-08-19");
    expect(result.requiredDateText).toBe("next week");
    // A brand was never stated, so it must stay null — never invented.
    expect(result.brand).toBeNull();
    expect(isRequirementComplete(result)).toBe(true);
  });

  it("extracts the TMT steel example including specification and location", () => {
    const result = extractRequirementDeterministic("20 tonnes 12mm TMT steel to Salem", {
      now: NOW,
    });

    expect(result.material).toBe("TMT steel");
    expect(result.specification).toBe("12mm");
    expect(result.quantity).toBe(20);
    expect(result.unit).toBe("tonnes");
    expect(result.location).toBe("Salem");
    // No delivery verb was used, so the delivery requirement is genuinely unknown.
    expect(result.deliveryRequired).toBeNull();
    expect(result.requiredDate).toBeNull();
  });

  it("infers a countable unit for '10,000 AAC blocks near Coimbatore'", () => {
    const result = extractRequirementDeterministic("10,000 AAC blocks near Coimbatore", {
      now: NOW,
    });

    expect(result.material).toBe("AAC blocks");
    expect(result.quantity).toBe(10000);
    expect(result.unit).toBe("nos");
    expect(result.location).toBe("Coimbatore");
  });
});

describe("extractRequirementDeterministic — never fabricates", () => {
  it("returns an all-null requirement for empty input", () => {
    expect(extractRequirementDeterministic("", { now: NOW })).toEqual({
      ...EMPTY_REQUIREMENT,
      constraints: [],
    });
  });

  it("does not guess a brand when no known brand appears in the text", () => {
    const result = extractRequirementDeterministic("500 bags cement to Erode", {
      now: NOW,
      knownBrands: ["UltraTech", "Dalmia"],
    });
    expect(result.brand).toBeNull();
  });

  it("extracts a brand only when it exactly matches real Brand master data", () => {
    const result = extractRequirementDeterministic("500 bags UltraTech cement to Erode", {
      now: NOW,
      knownBrands: ["UltraTech", "Dalmia"],
    });
    expect(result.brand).toBe("UltraTech");
  });

  it("leaves quantity/unit null when the customer gave no number", () => {
    const result = extractRequirementDeterministic("I need cement in Erode", { now: NOW });
    expect(result.quantity).toBeNull();
    expect(result.unit).toBeNull();
  });

  it("detects self-pickup as delivery NOT required", () => {
    const result = extractRequirementDeterministic("20 tonnes TMT steel, ex-works pickup", {
      now: NOW,
    });
    expect(result.deliveryRequired).toBe(false);
  });
});

describe("clarification questions", () => {
  it("asks nothing when every sourcing-critical field is present", () => {
    const complete = extractRequirementDeterministic(
      "500 bags of PPC cement delivered to Erode next week",
      { now: NOW }
    );
    expect(missingRequirementFields(complete)).toEqual([]);
    expect(nextClarificationQuestion(complete)).toBeNull();
  });

  it("does NOT treat a missing brand as a blocker", () => {
    const result = extractRequirementDeterministic("500 bags PPC cement to Erode", { now: NOW });
    expect(result.brand).toBeNull();
    expect(missingRequirementFields(result)).toEqual([]);
    expect(nextClarificationQuestion(result)).toBeNull();
  });

  it("asks for the location when only the location is missing", () => {
    const result = extractRequirementDeterministic("500 bags PPC cement", { now: NOW });
    expect(missingRequirementFields(result)).toEqual(["location"]);
    expect(nextClarificationQuestion(result)).toBe("Where should this be delivered?");
  });

  it("asks one question at a time, most fundamental first", () => {
    const result = extractRequirementDeterministic("I need something for my site", { now: NOW });
    expect(nextClarificationQuestion(result)).toBe("What material are you looking for?");
  });
});

describe("requirement merging across turns", () => {
  it("keeps earlier answers when a later turn omits them", () => {
    const first = extractRequirementDeterministic("500 bags PPC cement", { now: NOW });
    const second = extractRequirementDeterministic("deliver to Erode", { now: NOW });

    const merged = mergeRequirements(first, second);

    expect(merged.material).toBe("Cement");
    expect(merged.quantity).toBe(500);
    expect(merged.unit).toBe("bags");
    expect(merged.location).toBe("Erode");
    expect(isRequirementComplete(merged)).toBe(true);
  });

  it("lets a later turn correct an earlier value", () => {
    const first = extractRequirementDeterministic("500 bags PPC cement to Erode", { now: NOW });
    const second = extractRequirementDeterministic("actually make it 800 bags", { now: NOW });
    expect(mergeRequirements(first, second).quantity).toBe(800);
  });
});

describe("validateRequirement hardening", () => {
  it("rejects structurally invalid quantities instead of coercing them", () => {
    expect(validateRequirement({ quantity: -5 }).quantity).toBeNull();
    expect(validateRequirement({ quantity: 0 }).quantity).toBeNull();
    expect(validateRequirement({ quantity: "abc" }).quantity).toBeNull();
    expect(validateRequirement({ quantity: 99_000_000 }).quantity).toBeNull();
    expect(validateRequirement({ quantity: { evil: true } }).quantity).toBeNull();
  });

  it("rejects non-scalar injected values for text fields", () => {
    expect(validateRequirement({ material: { $ne: null } }).material).toBeNull();
    expect(validateRequirement({ location: ["Erode"] }).location).toBeNull();
  });

  it("accepts the spec's snake_case aliases", () => {
    const result = validateRequirement({
      material: "Cement",
      product_type: "PPC",
      quantity: "500",
      unit: "bags",
      delivery_location: "Erode",
      brand_preference: "none",
      delivery_required: true,
    });
    expect(result.specification).toBe("PPC");
    expect(result.location).toBe("Erode");
    expect(result.deliveryRequired).toBe(true);
  });

  it("normalizes unit synonyms and rejects unknown units", () => {
    expect(validateRequirement({ unit: "MT" }).unit).toBe("tonnes");
    expect(validateRequirement({ unit: "Bag" }).unit).toBe("bags");
    expect(validateRequirement({ unit: "furlongs" }).unit).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(validateRequirement({ requiredDate: "2026-02-31" }).requiredDate).toBeNull();
    expect(validateRequirement({ requiredDate: "next week" }).requiredDate).toBeNull();
    expect(validateRequirement({ requiredDate: "2026-08-19" }).requiredDate).toBe("2026-08-19");
  });
});
