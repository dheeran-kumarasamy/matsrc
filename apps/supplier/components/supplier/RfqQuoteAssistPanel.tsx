"use client";

// Phase 6B - RFQ Quote Assist (spec section 7).
//
// Additive, read-only "Market Guidance Only" side panel shown alongside
// (never replacing) QuoteResponseForm. It NEVER prefills/autofills the quote
// price input - it only displays aggregate district market statistics
// (median/p25/p75/confidence/trend/suggested band) already computed by the
// pricing serving layer, sourced via getRfqMarketGuidance (which itself only
// reads publicDisplayAllowed rows - see market-intelligence-data.ts).
//
// Collapsed by default; expanding it fires the
// "supplier_price_intel_rfq_assist_opened" analytics event (best-effort,
// never blocks the UI), matching the same fire-and-forget pattern used by
// MarketIntelligenceReportView.tsx.

import { useState } from "react";
import type { RfqMarketGuidance } from "@/lib/market-intelligence-data";

export type RfqMarketGuidanceView = RfqMarketGuidance;

function formatInr(value: number | null) {
  if (value === null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function trendLabel(direction: string | null) {
  if (direction === "RISING") return "Rising";
  if (direction === "FALLING") return "Falling";
  if (direction === "STABLE") return "Stable";
  return "-";
}

async function trackAnalyticsEvent(event: string, metadata: Record<string, unknown> = {}) {
  try {
    await fetch("/api/supplier/analytics/price-intelligence-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...metadata }),
    });
  } catch {
    // Best-effort only - never let analytics failures affect the RFQ flow.
  }
}

export function RfqQuoteAssistPanel({ rfqId, guidance }: { rfqId: string; guidance: RfqMarketGuidanceView }) {
  const [expanded, setExpanded] = useState(false);

  if (!guidance) return null;

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      void trackAnalyticsEvent("supplier_price_intel_rfq_assist_opened", { rfqId });
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-controls={`rfq-market-guidance-${rfqId}`}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <span>Market Guidance Only</span>
        <span aria-hidden="true">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded ? (
        <div id={`rfq-market-guidance-${rfqId}`} className="space-y-2 border-t border-sky-200 px-3 py-3 text-sm text-sky-900">
          <p className="text-xs text-sky-700">
            Guidance based on district market data. This is informational only and is never used to prefill your quote.
          </p>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-sky-600">District Median</dt>
              <dd className="font-semibold">{formatInr(guidance.districtMedian)}</dd>
            </div>
            <div>
              <dt className="text-xs text-sky-600">P25</dt>
              <dd className="font-semibold">{formatInr(guidance.p25)}</dd>
            </div>
            <div>
              <dt className="text-xs text-sky-600">P75</dt>
              <dd className="font-semibold">{formatInr(guidance.p75)}</dd>
            </div>
            <div>
              <dt className="text-xs text-sky-600">Confidence</dt>
              <dd className="font-semibold">{guidance.confidence ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-sky-600">Trend</dt>
              <dd className="font-semibold">{trendLabel(guidance.trendDirection)}</dd>
            </div>
            <div>
              <dt className="text-xs text-sky-600">Observations</dt>
              <dd className="font-semibold">{guidance.observationCount ?? "-"}</dd>
            </div>
          </dl>

          {guidance.suggestedBand ? (
            <div className="rounded-md bg-white px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Suggested Band</p>
              <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-sky-600">Conservative</p>
                  <p className="font-semibold">{formatInr(guidance.suggestedBand.conservative)}</p>
                </div>
                <div>
                  <p className="text-xs text-sky-600">Competitive</p>
                  <p className="font-semibold">{formatInr(guidance.suggestedBand.competitive)}</p>
                </div>
                <div>
                  <p className="text-xs text-sky-600">Premium</p>
                  <p className="font-semibold">{formatInr(guidance.suggestedBand.premium)}</p>
                </div>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-sky-600">Last updated: {guidance.lastUpdated ?? "-"}</p>
        </div>
      ) : null}
    </div>
  );
}
