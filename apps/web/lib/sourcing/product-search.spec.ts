// §25 "Product matching" tests — synonyms, spec/size discipline, and the
// §24 "no exact match, here are the real alternatives" behaviour.

import { describe, expect, it } from "vitest";

import {
  buildSearchQueries,
  buildSearchQuery,
  extractSizeToken,
  normalizeSizeTokens,
  searchProducts,
  type SourcingMatchableListing,
} from "./product-search";
import { validateRequirement } from "./requirement-schema";

function listing(
  overrides: Partial<SourcingMatchableListing> & { id: string; name: string }
): SourcingMatchableListing {
  return {
    category: "Steel",
    grade: "Fe500",
    unit: "MT",
    active: true,
    supplierId: `sup-${overrides.id}`,
    canonicalProductId: null,
    basePriceRaw: 60000,
    ...overrides,
  } as SourcingMatchableListing;
}

const STEEL_CATALOGUE: SourcingMatchableListing[] = [
  listing({ id: "p12", name: "TMT Steel 12mm", canonicalProductId: "c12" }),
  listing({ id: "p10", name: "TMT Steel 10mm", canonicalProductId: "c10" }),
  listing({ id: "p16", name: "TMT Steel 16mm", canonicalProductId: "c16" }),
];

describe("size token normalization", () => {
  it("collapses every millimetre spelling to the canonical form", () => {
    expect(normalizeSizeTokens("12 mm")).toBe("12mm");
    expect(normalizeSizeTokens("12mm")).toBe("12mm");
    expect(normalizeSizeTokens("12 millimeter")).toBe("12mm");
    expect(normalizeSizeTokens("12 Millimetres")).toBe("12mm");
  });

  it("extracts the size token from mixed text", () => {
    expect(extractSizeToken("12 mm TMT rod")).toBe("12mm");
    expect(extractSizeToken("TMT Steel 16mm")).toBe("16mm");
    expect(extractSizeToken("PPC cement")).toBeNull();
  });
});

describe("synonym expansion produces equivalent queries", () => {
  // §25: "12 mm TMT rod", "12mm TMT" and "12 millimeter steel rod" must all
  // resolve to the same catalogue product.
  const phrasings = [
    { material: "TMT steel", specification: "12 mm" },
    { material: "TMT", specification: "12mm" },
    { material: "steel rod", specification: "12 millimeter" },
  ];

  it("maps every phrasing of a 12mm TMT ask onto the 12mm listing", () => {
    for (const phrasing of phrasings) {
      const requirement = validateRequirement({
        ...phrasing,
        quantity: 20,
        unit: "tonnes",
        location: "Salem",
      });

      const outcome = searchProducts({ requirement, listings: STEEL_CATALOGUE });

      expect(outcome.matches.length).toBeGreaterThan(0);
      const ids = outcome.matches.map((match) => match.productId);
      // The 12mm listing must be the match; 10mm/16mm must never be returned
      // as a match for a 12mm request.
      expect(ids).toContain("p12");
      expect(ids).not.toContain("p10");
      expect(ids).not.toContain("p16");
    }
  });

  it("keeps the primary query precise (unpadded) so its match score stays high", () => {
    // Padding the query with synonyms would LOWER the matcher's
    // matchedTokens/queryTokens score, so the primary query must stay exact.
    expect(buildSearchQuery(validateRequirement({ material: "TMT steel", specification: "12 mm" }))).toBe(
      "tmt steel 12mm"
    );
  });

  it("offers synonym SUBSTITUTION variants so rod/bar/rebar reach a steel listing", () => {
    const variants = buildSearchQueries(validateRequirement({ material: "TMT rod", specification: "12mm" }));

    // The precise query comes first...
    expect(variants[0]).toBe("tmt rod 12mm");
    // ...and "rod" is substituted with its equivalents in later variants.
    expect(variants.some((query) => query.includes("bar"))).toBe(true);
    expect(variants.some((query) => query.includes("steel"))).toBe(true);
  });

  it("matches a 'rebar' phrasing onto the TMT steel listing", () => {
    const requirement = validateRequirement({
      material: "rebar",
      specification: "12mm",
      quantity: 20,
      unit: "tonnes",
      location: "Salem",
    });

    const outcome = searchProducts({ requirement, listings: STEEL_CATALOGUE });
    expect(outcome.matches.map((match) => match.productId)).toContain("p12");
  });
});

describe("no confident match — offers real alternatives, never a substitution", () => {
  it("does not substitute 10mm/16mm when 12mm is unavailable", () => {
    const catalogue = [
      listing({ id: "p10", name: "TMT Steel 10mm", canonicalProductId: "c10" }),
      listing({ id: "p16", name: "TMT Steel 16mm", canonicalProductId: "c16" }),
    ];

    const requirement = validateRequirement({
      material: "TMT steel",
      specification: "12mm",
      quantity: 20,
      unit: "tonnes",
      location: "Salem",
    });

    const outcome = searchProducts({ requirement, listings: catalogue });

    // No 12mm exists, so there must be NO confident match...
    expect(outcome.confident).toBe(false);
    expect(outcome.matches).toEqual([]);
    expect(outcome.needsClarification).toBe(true);
    // ...but the real 10mm/16mm options are offered for the customer to choose.
    const alternativeIds = outcome.alternatives.map((match) => match.productId);
    expect(alternativeIds).toContain("p10");
    expect(alternativeIds).toContain("p16");
  });

  it("returns no matches at all when the catalogue is empty", () => {
    const requirement = validateRequirement({
      material: "TMT steel",
      specification: "12mm",
      quantity: 20,
      unit: "tonnes",
      location: "Salem",
    });

    const outcome = searchProducts({ requirement, listings: [] });

    expect(outcome.confident).toBe(false);
    expect(outcome.matches).toEqual([]);
    expect(outcome.alternatives).toEqual([]);
    expect(outcome.needsClarification).toBe(true);
  });

  it("returns nothing when the requirement has no material yet", () => {
    const outcome = searchProducts({
      requirement: validateRequirement({ quantity: 20, unit: "tonnes" }),
      listings: STEEL_CATALOGUE,
    });
    expect(outcome.matches).toEqual([]);
    expect(outcome.needsClarification).toBe(true);
  });

  it("never matches an inactive listing", () => {
    const catalogue = [listing({ id: "p12", name: "TMT Steel 12mm", active: false })];
    const requirement = validateRequirement({
      material: "TMT steel",
      specification: "12mm",
      quantity: 20,
      unit: "tonnes",
      location: "Salem",
    });

    const outcome = searchProducts({ requirement, listings: catalogue });
    expect(outcome.matches).toEqual([]);
  });
});

describe("brand filtering", () => {
  it("prefers the requested brand when the catalogue really has it", () => {
    const catalogue = [
      listing({ id: "pa", name: "PPC Cement", category: "Cement", brand: "UltraTech", unit: "BAG" }),
      listing({ id: "pb", name: "PPC Cement", category: "Cement", brand: "Dalmia", unit: "BAG" }),
    ];

    const requirement = validateRequirement({
      material: "Cement",
      specification: "PPC",
      brand: "Dalmia",
      quantity: 500,
      unit: "bags",
      location: "Erode",
    });

    const outcome = searchProducts({ requirement, listings: catalogue });
    expect(outcome.matches.map((match) => match.productId)).toEqual(["pb"]);
  });
});
