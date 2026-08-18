// report-landed-cost.spec.ts — P1 (Matsrc Intelligence Integration).
import { describe, expect, it } from "vitest";
import { computeReportLandedCost } from "./report-landed-cost";

describe("computeReportLandedCost", () => {
  it("includes real observed freight in the total when known", () => {
    const result = computeReportLandedCost(355, 250);
    expect(result.basePrice).toBe(355);
    expect(result.estimatedDelivery).toBe(250);
    expect(result.dataGaps).not.toContain("freight");
    // material + freight, plus 18% GST on that subtotal
    expect(result.landedCost).toBeCloseTo((355 + 250) * 1.18, 2);
  });

  it("excludes freight from the total and records a data gap when freight is unknown, never fabricating a flat fee", () => {
    const result = computeReportLandedCost(355, null);
    expect(result.estimatedDelivery).toBe(0);
    expect(result.dataGaps).toContain("freight");
    // No flat ₹250 fee should ever be silently added.
    expect(result.landedCost).toBeCloseTo(355 * 1.18, 2);
  });

  it("applies the platform default GST rate", () => {
    const result = computeReportLandedCost(100, null);
    expect(result.gstRatePercent).toBe(18);
    expect(result.gstAmount).toBeCloseTo(18, 2);
  });
});
