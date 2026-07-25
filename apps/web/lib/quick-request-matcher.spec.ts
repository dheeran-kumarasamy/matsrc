import { describe, it, expect, vi } from "vitest";
import { matchQuickRequest, pickTieBreakWinner, type MatchableListing } from "./quick-request-matcher";

function listing(overrides: Partial<MatchableListing>): MatchableListing {
  return {
    id: "listing-1",
    name: "TMT Bar Fe-500D",
    category: "Steel",
    brand: "Tata",
    active: true,
    supplierId: "supplier-1",
    canonicalProductId: null,
    updatedAt: "2024-01-01T00:00:00.000Z",
    basePriceRaw: 100,
    ...overrides,
  };
}

describe("matchQuickRequest", () => {
  it("exact match: finds a listing whose name equals the query", () => {
    const listings = [
      listing({ id: "a", name: "TMT Bar Fe-500D", category: "Steel" }),
      listing({ id: "b", name: "Portland Cement", category: "Cement" }),
    ];

    const result = matchQuickRequest("TMT Bar Fe-500D", listings);

    expect(result.matched).toBe(true);
    expect(result.stage).toBe("exact");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].winner.id).toBe("a");
  });

  it("fuzzy match: tolerates a typo in the material name", () => {
    const listings = [
      listing({ id: "a", name: "Portland Cement", category: "Cement" }),
      listing({ id: "b", name: "Steel Rod", category: "Steel" }),
    ];

    const result = matchQuickRequest("Protland Sement", listings);

    expect(result.matched).toBe(true);
    expect(["exact", "fuzzy"]).toContain(result.stage);
    expect(result.groups.some((g) => g.winner.id === "a")).toBe(true);
  });

  it("category-level fallback: matches on category when name/fuzzy find nothing", () => {
    const listings = [
      listing({ id: "a", name: "XYZ Product Alpha", category: "Plumbing Fixtures" }),
    ];

    const result = matchQuickRequest("plumbing fixtures", listings);

    expect(result.matched).toBe(true);
    expect(result.groups[0].winner.id).toBe("a");
  });

  it("no-match fallback: returns matched:false when nothing is close", () => {
    const listings = [listing({ id: "a", name: "Portland Cement", category: "Cement" })];

    const result = matchQuickRequest("xyz completely unrelated widget 12345", listings);

    expect(result.matched).toBe(false);
    expect(result.stage).toBe("none");
    expect(result.groups).toHaveLength(0);
  });

  it("excludes inactive/delisted listings from every match stage", () => {
    const listings = [
      listing({ id: "a", name: "TMT Bar Fe-500D", category: "Steel", active: false }),
    ];

    const result = matchQuickRequest("TMT Bar Fe-500D", listings);

    expect(result.matched).toBe(false);
  });

  it("multi-supplier grouping: distinct canonical groups are all returned", () => {
    const listings = [
      listing({ id: "a1", name: "TMT Bar Fe-500D", canonicalProductId: "canon-1", supplierId: "sup-1" }),
      listing({ id: "a2", name: "TMT Bar Fe-500D", canonicalProductId: "canon-1", supplierId: "sup-2" }),
      listing({ id: "b1", name: "TMT Bar Fe-500D Deluxe", canonicalProductId: "canon-2", supplierId: "sup-3" }),
    ];

    const result = matchQuickRequest("TMT Bar Fe-500D", listings);

    expect(result.matched).toBe(true);
    // canon-1 group should have both suppliers as candidates
    const canon1Group = result.groups.find((g) => g.canonicalKey === "canon-1");
    expect(canon1Group?.candidates.length).toBe(2);
  });
});

describe("pickTieBreakWinner", () => {
  it("prefers the highest-rated supplier", () => {
    const a = listing({ id: "a", supplierId: "sup-a", updatedAt: "2024-01-01T00:00:00.000Z", basePriceRaw: 100 });
    const b = listing({ id: "b", supplierId: "sup-b", updatedAt: "2024-01-01T00:00:00.000Z", basePriceRaw: 100 });

    const getRating = vi.fn((supplierId: string) => (supplierId === "sup-b" ? 4.5 : 3.0));

    const { winner, reason } = pickTieBreakWinner([a, b], getRating);

    expect(winner.id).toBe("b");
    expect(reason).toContain("rating");
  });

  it("falls back to most recent updatedAt when ratings tie", () => {
    const a = listing({ id: "a", supplierId: "sup-a", updatedAt: "2024-01-01T00:00:00.000Z" });
    const b = listing({ id: "b", supplierId: "sup-b", updatedAt: "2024-06-01T00:00:00.000Z" });

    const { winner } = pickTieBreakWinner([a, b], () => 4.0);

    expect(winner.id).toBe("b");
  });

  it("falls back to lowest price when rating and recency tie", () => {
    const a = listing({ id: "a", supplierId: "sup-a", updatedAt: "2024-01-01T00:00:00.000Z", basePriceRaw: 200 });
    const b = listing({ id: "b", supplierId: "sup-b", updatedAt: "2024-01-01T00:00:00.000Z", basePriceRaw: 150 });

    const { winner } = pickTieBreakWinner([a, b], () => 4.0);

    expect(winner.id).toBe("b");
  });

  it("falls back to listingId when everything else ties (deterministic last resort)", () => {
    const a = listing({ id: "z-listing", supplierId: "sup-a", updatedAt: "2024-01-01T00:00:00.000Z", basePriceRaw: 100 });
    const b = listing({ id: "a-listing", supplierId: "sup-b", updatedAt: "2024-01-01T00:00:00.000Z", basePriceRaw: 100 });

    const { winner } = pickTieBreakWinner([a, b], () => null);

    expect(winner.id).toBe("a-listing");
  });
});
