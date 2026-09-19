// Regression tests for the pricing-geography refinement: Erode -> Erode
// District -> Tamil Nadu must resolve through the platform's REAL
// PricingDistrict/PricingState hierarchy, and "Tamil Nadu" must never be
// treated as a competing/non-applicable geography for an "Erode" request.

import { describe, expect, it } from "vitest";

import { buildGeographyIndex, resolveState } from "./geography";
import { classifyLocality } from "./supplier-search";

// Mirrors the real production rows found during the investigation:
// PricingDistrict "Erode" (code TN-ERO) belongs to PricingState "Tamil Nadu"
// (code TN); a second state ("Delhi") also exists so cross-state exclusion
// can be verified.
const DISTRICTS = [
  { name: "Erode", stateName: "Tamil Nadu" },
  { name: "Coimbatore", stateName: "Tamil Nadu" },
  { name: "Chennai", stateName: "Tamil Nadu" },
];
const STATES = [
  { name: "Tamil Nadu", code: "TN" },
  { name: "Delhi", code: "DL" },
];

const GEOGRAPHY = buildGeographyIndex(DISTRICTS, STATES);

describe("resolveState — district/state hierarchy", () => {
  it("resolves a district name to its real state", () => {
    expect(resolveState("Erode", GEOGRAPHY)).toBe("Tamil Nadu");
  });

  it("resolves a state name/code to itself", () => {
    expect(resolveState("Tamil Nadu", GEOGRAPHY)).toBe("Tamil Nadu");
    expect(resolveState("TN", GEOGRAPHY)).toBe("Tamil Nadu");
  });

  it("is tolerant of the free-text spelling used by SupplierProfile.region", () => {
    // Real production data stores the state as "Tamilnadu" (no space) on
    // SupplierProfile.region, vs "Tamil Nadu" (spaced) on PricingState.name.
    expect(resolveState("Tamilnadu", GEOGRAPHY)).toBe("Tamil Nadu");
  });

  it("returns null for a genuinely unknown place", () => {
    expect(resolveState("Atlantis", GEOGRAPHY)).toBeNull();
  });
});

describe("classifyLocality — MANDATORY: Tamil Nadu must be applicable to Erode", () => {
  it('supplier region "Tamilnadu" is applicable (STATE) for a request to "Erode", never excluded', () => {
    const locality = classifyLocality("Tamilnadu", "Erode", GEOGRAPHY);
    expect(locality).toBe("STATE");
    // Must never be classified as if it were unrelated/non-applicable.
    expect(locality).not.toBe("NON_LOCAL");
    expect(locality).not.toBe("UNKNOWN");
  });

  it('supplier region "Tamil Nadu" (spaced, matching PricingState.name) is also applicable to Erode', () => {
    expect(classifyLocality("Tamil Nadu", "Erode", GEOGRAPHY)).toBe("STATE");
  });

  it("an exact district match is still LOCAL, not merely STATE", () => {
    expect(classifyLocality("Erode", "Erode", GEOGRAPHY)).toBe("LOCAL");
  });

  it("a different state's supplier is NON_LOCAL, not STATE", () => {
    expect(classifyLocality("Delhi", "Erode", GEOGRAPHY)).toBe("NON_LOCAL");
  });

  it("a blank region remains UNKNOWN even with a geography index available", () => {
    expect(classifyLocality(null, "Erode", GEOGRAPHY)).toBe("UNKNOWN");
  });

  it("without a geography index, behaviour is unchanged (falls back to NON_LOCAL, never STATE)", () => {
    // Backward compatibility: callers that have not loaded geography data
    // (or where it failed to load) must keep the pre-refinement behaviour.
    expect(classifyLocality("Tamilnadu", "Erode")).toBe("NON_LOCAL");
    expect(classifyLocality("Erode", "Erode")).toBe("LOCAL");
    expect(classifyLocality(null, "Erode")).toBe("UNKNOWN");
  });
});
