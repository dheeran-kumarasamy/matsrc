"use client";

// Shared empty/error states for the District Price Intelligence panel.
// Every state explains WHY and offers a "Request Quote" CTA so builders are
// never left with a dead end just because market data is unavailable.

import type { DistrictPricePanelEmptyReason } from "@/lib/district-pricing-types";

const EMPTY_REASON_COPY: Record<DistrictPricePanelEmptyReason, { title: string; description: string }> = {
  NO_SKU_MATCH: {
    title: "Market data isn't mapped for this product yet",
    description:
      "We haven't linked this product to our district price intelligence data yet. You can still request a quote directly from suppliers.",
  },
  NO_DISTRICT_DATA: {
    title: "No verified price available",
    description:
      "We don't have verified market pricing for this material in your district yet. We never substitute another district's price silently.",
  },
  NO_TREND_DATA: {
    title: "Not enough history for a trend yet",
    description: "We don't have enough historical observations to show a price trend for this material and district.",
  },
  NO_COMPARISON_DATA: {
    title: "No nearby district data available",
    description: "We don't have verified pricing for nearby districts to compare against yet.",
  },
};

export function PriceIntelligenceEmptyState({
  reason,
  onRequestQuote,
}: {
  reason: DistrictPricePanelEmptyReason;
  onRequestQuote?: () => void;
}) {
  const copy = EMPTY_REASON_COPY[reason];
  return (
    <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center">
      <p className="text-sm font-semibold text-slate-700">{copy.title}</p>
      <p className="mt-1 text-sm text-slate-500">{copy.description}</p>
      {onRequestQuote ? (
        <button
          onClick={onRequestQuote}
          className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
        >
          Request Quote
        </button>
      ) : null}
    </div>
  );
}

export function PriceIntelligenceErrorState({
  message,
  onRetry,
  onRequestQuote,
}: {
  message?: string;
  onRetry: () => void;
  onRequestQuote?: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center">
      <p className="text-sm font-semibold text-rose-700">Couldn&apos;t load market data</p>
      <p className="mt-1 text-sm text-rose-600">
        {message || "Something went wrong while fetching price intelligence. Please try again."}
      </p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          onClick={onRetry}
          className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
        >
          Retry
        </button>
        {onRequestQuote ? (
          <button
            onClick={onRequestQuote}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
          >
            Request Quote
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PriceIntelligenceLoadingState() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-3 rounded-xl border border-slate-200 p-5">
      <div className="h-4 w-1/3 rounded bg-slate-200" />
      <div className="h-24 w-full rounded bg-slate-100" />
      <span className="sr-only">Loading district price intelligence…</span>
    </div>
  );
}
