import { describe, it, expect } from "vitest";
import {
  toMethodLabel,
  computeFreshness,
  computeMarketPosition,
  computeDiffPct,
  tierLabel,
  buildSourceBreakdown,
} from "./district-pricing";

describe("toMethodLabel", () => {
  it("maps OBSERVED to Observed", () => {
    expect(toMethodLabel("OBSERVED")).toBe("Observed");
  });

  it("maps DERIVED_FREIGHT to Derived + Freight", () => {
    expect(toMethodLabel("DERIVED_FREIGHT")).toBe("Derived + Freight");
  });

  it("maps DERIVED_INDEX to Derived + DES Index", () => {
    expect(toMethodLabel("DERIVED_INDEX")).toBe("Derived + DES Index");
  });

  it("maps DERIVED_BLENDED to Derived + Freight", () => {
    expect(toMethodLabel("DERIVED_BLENDED")).toBe("Derived + Freight");
  });

  it("maps MANUAL_OVERRIDE to Manual Override", () => {
    expect(toMethodLabel("MANUAL_OVERRIDE")).toBe("Manual Override");
  });

  it("falls back to Derived for unknown methods", () => {
    expect(toMethodLabel("SOMETHING_UNKNOWN")).toBe("Derived");
  });
});

describe("computeFreshness", () => {
  it("labels same-day prices as Updated Today and not stale", () => {
    const now = new Date("2024-06-10T12:00:00Z");
    const priceDate = new Date("2024-06-10T00:00:00Z");
    const result = computeFreshness(priceDate, now, 72);
    expect(result.label).toBe("Updated Today");
    expect(result.isStale).toBe(false);
  });

  it("labels 1-day-old prices as Updated Yesterday", () => {
    const now = new Date("2024-06-10T12:00:00Z");
    const priceDate = new Date("2024-06-09T12:00:00Z");
    const result = computeFreshness(priceDate, now, 72);
    expect(result.label).toBe("Updated Yesterday");
    expect(result.isStale).toBe(false);
  });

  it("labels older prices with day count and marks stale beyond SLA", () => {
    const now = new Date("2024-06-10T00:00:00Z");
    const priceDate = new Date("2024-06-05T00:00:00Z"); // 5 days ago
    const result = computeFreshness(priceDate, now, 72); // SLA = 3 days
    expect(result.label).toBe("Updated 5 days ago");
    expect(result.isStale).toBe(true);
  });

  it("defaults to a 3-day SLA when freshnessSlaHours is null", () => {
    const now = new Date("2024-06-10T00:00:00Z");
    const priceDate = new Date("2024-06-06T00:00:00Z"); // 4 days ago
    const result = computeFreshness(priceDate, now, null);
    expect(result.isStale).toBe(true);
  });
});

describe("computeMarketPosition", () => {
  it("classifies a price below the P25 band as BELOW", () => {
    const result = computeMarketPosition(80, 100, 90, 110);
    expect(result.status).toBe("BELOW");
    expect(result.diffPct).toBeCloseTo(-20, 5);
  });

  it("classifies a price above the P75 band as ABOVE", () => {
    const result = computeMarketPosition(120, 100, 90, 110);
    expect(result.status).toBe("ABOVE");
    expect(result.diffPct).toBeCloseTo(20, 5);
  });

  it("classifies a price within the P25-P75 band as WITHIN", () => {
    const result = computeMarketPosition(100, 100, 90, 110);
    expect(result.status).toBe("WITHIN");
  });

  it("falls back to a +/-5% median band when P25/P75 are absent", () => {
    const within = computeMarketPosition(102, 100, null, null);
    expect(within.status).toBe("WITHIN");

    const above = computeMarketPosition(110, 100, null, null);
    expect(above.status).toBe("ABOVE");

    const below = computeMarketPosition(90, 100, null, null);
    expect(below.status).toBe("BELOW");
  });

  it("returns 0 diffPct when median is 0", () => {
    const result = computeMarketPosition(50, 0, null, null);
    expect(result.diffPct).toBe(0);
  });
});

describe("computeDiffPct", () => {
  it("computes a positive percentage difference", () => {
    expect(computeDiffPct(110, 100)).toBeCloseTo(10, 5);
  });

  it("computes a negative percentage difference", () => {
    expect(computeDiffPct(90, 100)).toBeCloseTo(-10, 5);
  });

  it("returns null when baseline is 0", () => {
    expect(computeDiffPct(50, 0)).toBeNull();
  });
});

describe("tierLabel", () => {
  it("maps known tiers to friendly labels", () => {
    expect(tierLabel("GOVERNMENT")).toBe("Government Sources");
    expect(tierLabel("MANUFACTURER")).toBe("Manufacturer Sources");
    expect(tierLabel("AGGREGATOR")).toBe("Aggregator Sources");
    expect(tierLabel("MARKETPLACE")).toBe("Marketplace Sources");
    expect(tierLabel("INTERNAL")).toBe("Internal (Matsrc) Sources");
  });

  it("falls back to the raw tier for unknown values", () => {
    expect(tierLabel("MYSTERY")).toBe("MYSTERY");
  });
});

describe("buildSourceBreakdown", () => {
  it("groups sources by tier, counts them, and dedupes attribution text", () => {
    const result = buildSourceBreakdown([
      { tier: "GOVERNMENT", attributionText: "Dept. of X" },
      { tier: "GOVERNMENT", attributionText: "Dept. of X" },
      { tier: "MARKETPLACE", attributionText: null },
      { tier: "MANUFACTURER", attributionText: "Acme Corp" },
    ]);

    const government = result.find((r) => r.tier === "GOVERNMENT");
    expect(government?.sourceCount).toBe(2);
    expect(government?.attributionText).toBe("Dept. of X");
    expect(government?.label).toBe("Government Sources");

    const marketplace = result.find((r) => r.tier === "MARKETPLACE");
    expect(marketplace?.sourceCount).toBe(1);
    expect(marketplace?.attributionText).toBeNull();
  });

  it("sorts breakdown entries by source count descending", () => {
    const result = buildSourceBreakdown([
      { tier: "MARKETPLACE", attributionText: null },
      { tier: "GOVERNMENT", attributionText: null },
      { tier: "GOVERNMENT", attributionText: null },
      { tier: "GOVERNMENT", attributionText: null },
    ]);

    expect(result[0].tier).toBe("GOVERNMENT");
    expect(result[0].sourceCount).toBe(3);
  });

  it("returns an empty array when given no sources", () => {
    expect(buildSourceBreakdown([])).toEqual([]);
  });
});
