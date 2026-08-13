// sourcing-risk.ts — deterministic risk identification engine (Phase 8).
//
// Identifies risks that are GROUNDED IN DATA. No risk is fabricated from a
// heuristic that has no data support. Each risk code maps to a customer-facing
// message that discloses the evidence (or lack thereof), never an accusation.
//
// The LLM may explain risks but must not invent new ones.

import type { PriceFreshness } from "./price-history";
import type { TrendDirection } from "./price-trend";
import type { ConfidenceLevel } from "./confidence";

export type RiskCode =
  | "LOW_PRICE_CONFIDENCE"
  | "STALE_PRICE"
  | "INSUFFICIENT_HISTORY"
  | "HIGH_PRICE_VOLATILITY"
  | "DELIVERY_UNCERTAINTY"
  | "PRODUCT_MATCH_UNCERTAINTY"
  | "LIMITED_SUPPLIER_DATA"
  | "PRICE_ABOVE_AVERAGE"
  | "FORECAST_LOW_CONFIDENCE";

export type SourcingRisk = {
  code: RiskCode;
  /** One sentence, factual. No speculation. */
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
};

export type RiskInput = {
  priceConfidence: ConfidenceLevel;
  freshness: PriceFreshness;
  observationCount: number;
  trendDirection: TrendDirection;
  hasDeliveryEstimate: boolean;
  productMatchStage: "exact" | "fuzzy" | "category" | null;
  hasSupplierPrice: boolean;
  vsAveragePct: number | null;
  forecastHasEnoughData: boolean;
};

/**
 * Identifies concrete, evidence-based risks for the sourcing recommendation.
 *
 * Returns an empty array when no risks are detected — the caller must not
 * invent risks or add defaults "just in case".
 */
export function identifyRisks(input: RiskInput): SourcingRisk[] {
  const risks: SourcingRisk[] = [];

  if (input.priceConfidence === "INSUFFICIENT_DATA") {
    risks.push({
      code: "LOW_PRICE_CONFIDENCE",
      message: "Not enough verified pricing data to make a confident recommendation.",
      severity: "CRITICAL",
    });
  } else if (input.priceConfidence === "LOW") {
    risks.push({
      code: "LOW_PRICE_CONFIDENCE",
      message: "Current pricing data has low confidence — fewer verified sources than expected.",
      severity: "WARNING",
    });
  }

  if (input.freshness === "STALE") {
    risks.push({
      code: "STALE_PRICE",
      message: "Price data is older than 7 days. Current market prices may differ.",
      severity: "WARNING",
    });
  }

  if (input.observationCount < 3) {
    risks.push({
      code: "INSUFFICIENT_HISTORY",
      message: "Fewer than 3 price observations are available. Statistics may not be reliable.",
      severity: "WARNING",
    });
  }

  if (input.trendDirection === "VOLATILE") {
    risks.push({
      code: "HIGH_PRICE_VOLATILITY",
      message: "Price has been volatile recently. The landed cost estimate may change quickly.",
      severity: "WARNING",
    });
  }

  if (!input.hasDeliveryEstimate) {
    risks.push({
      code: "DELIVERY_UNCERTAINTY",
      message: "Delivery time information is not available for this supplier.",
      severity: "INFO",
    });
  }

  if (input.productMatchStage === "category") {
    risks.push({
      code: "PRODUCT_MATCH_UNCERTAINTY",
      message: "Product was matched at the category level only — the exact specification may differ.",
      severity: "WARNING",
    });
  } else if (input.productMatchStage === "fuzzy") {
    risks.push({
      code: "PRODUCT_MATCH_UNCERTAINTY",
      message: "Product was matched approximately — confirm the specification before proceeding.",
      severity: "INFO",
    });
  }

  if (!input.hasSupplierPrice) {
    risks.push({
      code: "LIMITED_SUPPLIER_DATA",
      message: "Supplier's current price is unavailable. A fresh quotation is recommended.",
      severity: "WARNING",
    });
  }

  if (input.vsAveragePct !== null && input.vsAveragePct > 10) {
    risks.push({
      code: "PRICE_ABOVE_AVERAGE",
      message: `Current price is ${input.vsAveragePct.toFixed(1)}% above the recent average.`,
      severity: "INFO",
    });
  }

  if (!input.forecastHasEnoughData) {
    risks.push({
      code: "FORECAST_LOW_CONFIDENCE",
      message: "Not enough historical data for a reliable price forecast.",
      severity: "INFO",
    });
  }

  // Dedupe by code (highest severity wins).
  const seen = new Map<RiskCode, SourcingRisk>();
  const severityOrder = { CRITICAL: 3, WARNING: 2, INFO: 1 };
  for (const risk of risks) {
    const existing = seen.get(risk.code);
    if (!existing || severityOrder[risk.severity] > severityOrder[existing.severity]) {
      seen.set(risk.code, risk);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    const order = severityOrder;
    return order[b.severity] - order[a.severity];
  });
}
