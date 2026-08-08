import { describe, expect, it } from "vitest";
import { median, percentile, scaledMedianAbsoluteDeviation, sortNumeric } from "./pricing-stats.util";

describe("sortNumeric", () => {
  it("returns a new sorted array without mutating the input", () => {
    const input = [5, 1, 3];
    const result = sortNumeric(input);
    expect(result).toEqual([1, 3, 5]);
    expect(input).toEqual([5, 1, 3]); // not mutated
  });
});

describe("median", () => {
  it("returns null for an empty array", () => {
    expect(median([])).toBeNull();
  });

  it("returns the middle value for an odd-length sorted array", () => {
    expect(median([1, 2, 3])).toBe(2);
  });

  it("averages the two middle values for an even-length sorted array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns the single value for a one-element array", () => {
    expect(median([42])).toBe(42);
  });
});

describe("percentile", () => {
  it("returns null for an empty array", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("returns the single value for a one-element array regardless of p", () => {
    expect(percentile([10], 0.25)).toBe(10);
    expect(percentile([10], 0.75)).toBe(10);
  });

  it("returns an exact element when the rank lands precisely on an index", () => {
    // sorted [10,20,30,40,50], p=0.5 -> rank=2 -> exact index 2 -> 30
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });

  it("linearly interpolates between two elements when the rank is fractional", () => {
    // sorted [10,20,30,40], p=0.25 -> rank = 0.25*3 = 0.75 -> between index 0 and 1
    expect(percentile([10, 20, 30, 40], 0.25)).toBeCloseTo(17.5);
  });

  it("computes p75 correctly for a 4-element array", () => {
    // rank = 0.75*3 = 2.25 -> between index 2 (30) and 3 (40)
    expect(percentile([10, 20, 30, 40], 0.75)).toBeCloseTo(32.5);
  });
});

describe("scaledMedianAbsoluteDeviation", () => {
  it("returns scaledMad of 0 when every value is identical", () => {
    const { median: med, scaledMad } = scaledMedianAbsoluteDeviation([50, 50, 50, 50]);
    expect(med).toBe(50);
    expect(scaledMad).toBe(0);
  });

  it("computes median and a non-zero scaled MAD for varied values", () => {
    const { median: med, scaledMad } = scaledMedianAbsoluteDeviation([1, 2, 3, 4, 100]);
    expect(med).toBe(3);
    expect(scaledMad).toBeGreaterThan(0);
    // deviations from median 3: [2,1,0,1,97] -> sorted [0,1,1,2,97] -> mad=1 -> scaled=1.4826
    expect(scaledMad).toBeCloseTo(1.4826, 4);
  });

  it("does not mutate the input array (defensive copy before sort)", () => {
    const values = [5, 1, 3];
    scaledMedianAbsoluteDeviation(values);
    expect(values).toEqual([5, 1, 3]);
  });
});
