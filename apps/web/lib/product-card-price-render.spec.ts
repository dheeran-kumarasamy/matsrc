import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

// Regression guard for the /products PLP price display change: the card must
// render "Starting from ₹Xxx" and must NEVER render a "₹min – ₹max" range.
// The repo has no React component-test harness configured (no
// testing-library/jsdom wired into vitest.config.ts), so per the "reuse
// existing production implementation" requirement this asserts against the
// actual rendered ProductCard.tsx source rather than introducing a new test
// framework/dependency.
const productCardSource = readFileSync(
  path.resolve(__dirname, "../components/products/ProductCard.tsx"),
  "utf-8"
);

describe("ProductCard price display (source regression guard)", () => {
  it("renders the 'Starting from' label", () => {
    expect(productCardSource).toMatch(/Starting from/);
  });

  it("uses the single-minimum-price resolver, not the old min–max range fields directly", () => {
    expect(productCardSource).toMatch(/resolveStartingDisplayPrice/);
  });

  it("no longer renders a '₹min – ₹max' range template", () => {
    // The old implementation rendered:
    //   ₹{product.minPrice.toLocaleString("en-IN")} – ₹{product.maxPrice.toLocaleString("en-IN")}
    expect(productCardSource).not.toMatch(/minPrice\.toLocaleString/);
    expect(productCardSource).not.toMatch(/maxPrice\.toLocaleString/);
  });

  it("shows an explicit unavailable state rather than a fabricated ₹0", () => {
    expect(productCardSource).toMatch(/Price unavailable/);
  });
});
