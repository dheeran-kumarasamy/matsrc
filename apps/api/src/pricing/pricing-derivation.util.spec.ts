import { describe, expect, it } from "vitest";
import { deriveDistrictPrice } from "./pricing-derivation.util";

describe("deriveDistrictPrice", () => {
  it("returns null when neither DERIVED_INDEX nor DERIVED_FREIGHT inputs are available (never fabricates)", () => {
    const result = deriveDistrictPrice({ anchorMedianPerBaseUnit: 100 });
    expect(result).toBeNull();
  });

  it("returns null when anchorCostIndex is 0 (would divide by zero / meaningless ratio)", () => {
    const result = deriveDistrictPrice({
      anchorMedianPerBaseUnit: 100,
      districtCostIndex: 120,
      anchorCostIndex: 0,
    });
    expect(result).toBeNull();
  });

  it("computes DERIVED_INDEX when both cost indexes are present", () => {
    const result = deriveDistrictPrice({
      anchorMedianPerBaseUnit: 100,
      districtCostIndex: 120,
      anchorCostIndex: 100,
    });
    expect(result).not.toBeNull();
    expect(result!.method).toBe("DERIVED_INDEX");
    expect(result!.value).toBeCloseTo(120); // 100 * (120/100)
  });

  it("computes DERIVED_FREIGHT when distance and freight rate are present", () => {
    const result = deriveDistrictPrice({
      anchorMedianPerBaseUnit: 100,
      anchorRoadDistanceKm: 50,
      freightRatePerKmPerBaseUnit: 0.5,
    });
    expect(result).not.toBeNull();
    expect(result!.method).toBe("DERIVED_FREIGHT");
    expect(result!.value).toBeCloseTo(125); // 100 + 50*0.5
  });

  it("does not attempt DERIVED_FREIGHT when freightRatePerKmPerBaseUnit is unconfigured (null)", () => {
    const result = deriveDistrictPrice({
      anchorMedianPerBaseUnit: 100,
      anchorRoadDistanceKm: 50,
      freightRatePerKmPerBaseUnit: null,
    });
    expect(result).toBeNull();
  });

  it("blends both strategies into DERIVED_BLENDED when both are available", () => {
    const result = deriveDistrictPrice({
      anchorMedianPerBaseUnit: 100,
      districtCostIndex: 120,
      anchorCostIndex: 100, // DERIVED_INDEX -> 120
      anchorRoadDistanceKm: 50,
      freightRatePerKmPerBaseUnit: 0.5, // DERIVED_FREIGHT -> 125
    });
    expect(result).not.toBeNull();
    expect(result!.method).toBe("DERIVED_BLENDED");
    expect(result!.value).toBeCloseTo(122.5); // (120+125)/2
  });

  it("applies the SOR area supplement percentage multiplicatively on top of the derived value", () => {
    const result = deriveDistrictPrice({
      anchorMedianPerBaseUnit: 100,
      anchorRoadDistanceKm: 50,
      freightRatePerKmPerBaseUnit: 0.5, // base derived value: 125
      sorAreaSupplementPct: 10,
    });
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(137.5); // 125 * 1.10
    expect(result!.derivationJson.valueBeforeSorSupplement).toBeCloseTo(125);
  });

  it("does not apply a supplement when sorAreaSupplementPct is null/undefined", () => {
    const result = deriveDistrictPrice({
      anchorMedianPerBaseUnit: 100,
      anchorRoadDistanceKm: 50,
      freightRatePerKmPerBaseUnit: 0.5,
    });
    expect(result!.value).toBeCloseTo(125);
    expect(result!.derivationJson.sorAreaSupplementPct).toBeUndefined();
  });
});
