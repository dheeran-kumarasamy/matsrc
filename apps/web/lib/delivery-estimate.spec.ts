import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { DELIVERY_TIMING_BROWSING_NOTE } from "./delivery-estimate";

// C13 regression guard: the PLP card and quick-view must surface SOME
// delivery-timing information while browsing, using the shared constant
// (no fabricated/hard-coded per-product date or day-range, since no
// reliable per-listing delivery estimate exists in the schema — see this
// module's own doc comment).
describe("DELIVERY_TIMING_BROWSING_NOTE", () => {
  it("is a non-empty, truthful string (not a fabricated date/day-range)", () => {
    expect(DELIVERY_TIMING_BROWSING_NOTE.length).toBeGreaterThan(0);
    // Must never look like a fabricated concrete date or "X-Y days" range.
    expect(DELIVERY_TIMING_BROWSING_NOTE).not.toMatch(/\d/);
  });
});

const productCardSource = readFileSync(
  path.resolve(__dirname, "../components/products/ProductCard.tsx"),
  "utf-8"
);
const quickViewSource = readFileSync(
  path.resolve(__dirname, "../components/products/ProductQuickView.tsx"),
  "utf-8"
);

describe("Delivery timing visible while browsing (source regression guard)", () => {
  it("ProductCard renders the shared delivery-timing note", () => {
    expect(productCardSource).toMatch(/DELIVERY_TIMING_BROWSING_NOTE/);
  });

  it("ProductQuickView renders the shared delivery-timing note", () => {
    expect(quickViewSource).toMatch(/DELIVERY_TIMING_BROWSING_NOTE/);
  });

  it("neither surface hard-codes a fabricated delivery date/day-range", () => {
    expect(productCardSource).not.toMatch(/Estimated delivery: \d/);
    expect(quickViewSource).not.toMatch(/Estimated delivery: \d/);
  });
});
