import { describe, it, expect } from "vitest";
import { resolveStartingDisplayPrice, formatStartingPriceLabel } from "./product-price-display";

describe("resolveStartingDisplayPrice", () => {
  it("uses startingPrice (the cross-supplier/cross-tier minimum) when present", () => {
    expect(resolveStartingDisplayPrice({ startingPrice: 495, price: 550 })).toBe(495);
  });

  it("falls back to the legacy price field when startingPrice is absent (backward compatibility)", () => {
    expect(resolveStartingDisplayPrice({ price: 550 })).toBe(550);
  });

  it("falls back to price when startingPrice is null", () => {
    expect(resolveStartingDisplayPrice({ startingPrice: null, price: 550 })).toBe(550);
  });

  it("never returns a fabricated ₹0 — returns null when startingPrice is 0", () => {
    expect(resolveStartingDisplayPrice({ startingPrice: 0, price: 0 })).toBeNull();
  });

  it("never returns a negative price — returns null when startingPrice is negative", () => {
    expect(resolveStartingDisplayPrice({ startingPrice: -100 })).toBeNull();
  });

  it("returns null when neither startingPrice nor price is a valid positive number", () => {
    expect(resolveStartingDisplayPrice({})).toBeNull();
    expect(resolveStartingDisplayPrice({ startingPrice: null, price: null })).toBeNull();
    expect(resolveStartingDisplayPrice({ startingPrice: NaN })).toBeNull();
  });
});

describe("formatStartingPriceLabel", () => {
  it("formats a price with en-IN thousands grouping and a ₹ prefix", () => {
    expect(formatStartingPriceLabel(495)).toBe("₹495");
    expect(formatStartingPriceLabel(150000)).toBe("₹1,50,000");
  });
});
