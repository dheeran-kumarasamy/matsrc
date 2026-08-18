// report-landed-cost.ts — P1 (Matsrc Intelligence Integration).
//
// The price report's "Best price finder" module previously used
// lib/price-forecast.ts's estimateLandedCost(), which always injects a flat
// ₹250 "indicative delivery fee" — i.e. it never actually reports that
// freight is unknown, even when the platform has no real freight
// observation for that supplier/lane. This adapter switches the report onto
// lib/sourcing/landed-cost.ts's calculateLandedCost(), the same function the
// AI Sourcing Assistant uses, which correctly EXCLUDES freight from the
// total and records a "freight" data gap when no real observation exists,
// rather than inventing a number.
//
// Maps calculateLandedCost()'s output onto the report's existing
// LandedCostBreakdown UI shape (lib/price-report-types.ts) additively —
// the report module components are not restructured in this pass.

import { calculateLandedCost, DEFAULT_TAX_RATE_PERCENT } from "./sourcing/landed-cost";
import type { LandedCostBreakdown as ReportLandedCostBreakdown } from "./price-report-types";

/**
 * Computes one supplier offer's landed cost for the report, using the same
 * deterministic calculator as the sourcing assistant. `freightCost` is the
 * real observed freight for this product (from PricePoint), or null when the
 * platform has none — never a fabricated flat fee.
 */
export function computeReportLandedCost(
  unitPrice: number,
  freightCost: number | null
): ReportLandedCostBreakdown & { dataGaps: string[] } {
  const breakdown = calculateLandedCost({
    quantity: 1,
    unitMaterialPrice: unitPrice,
    freightCost,
  });

  // unitMaterialPrice is always provided here (offer.basePrice is never
  // null), so estimatedLandedCost/materialCost are guaranteed non-null —
  // but the types are still nullable from the shared calculator, so guard
  // rather than assert.
  const materialCost = breakdown.materialCost ?? unitPrice;
  const taxAmount = breakdown.taxAmount ?? 0;
  const landedCost = breakdown.estimatedLandedCost ?? materialCost;

  return {
    basePrice: unitPrice,
    quantity: breakdown.quantity,
    subtotal: materialCost + (breakdown.freightCost ?? 0),
    // Kept for backward compatibility with the existing report UI's "Delivery
    // (est.)" line — now reports the REAL observed freight (or 0 when
    // genuinely unknown, disclosed via dataGaps rather than presented as a
    // confident estimate).
    estimatedDelivery: breakdown.freightCost ?? 0,
    gstRatePercent: DEFAULT_TAX_RATE_PERCENT,
    gstAmount: taxAmount,
    landedCost,
    landedUnitCost: landedCost / breakdown.quantity,
    dataGaps: breakdown.dataGaps,
  };
}
