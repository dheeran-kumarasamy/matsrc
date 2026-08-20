"use client";

import type {
  DistrictPricePanelCurrent,
  DistrictPricePanelSourceBreakdownEntry,
} from "@/lib/district-pricing-types";

// Explains WHERE a price comes from and HOW confident we are — never
// exposes INTERNAL_ONLY sources (already filtered out before this
// component ever receives `sources`).
export default function PriceExplanationCard({
  current,
  sources,
}: {
  current: DistrictPricePanelCurrent;
  sources: DistrictPricePanelSourceBreakdownEntry[];
}) {
  const confidenceExplanation: Record<string, string> = {
    HIGH: "Backed by a strong number of independent, recent observations.",
    MEDIUM: "Based on a moderate number of observations — treat as a good estimate.",
    LOW: "Limited observations available — treat this price as indicative only.",
  };

  const methodExplanation: Record<string, string> = {
    Observed: "This price is directly observed from real market listings/quotes in this district.",
    Derived: "This price is estimated from nearby market data using our derivation model.",
    "Derived + Freight": "Estimated by adjusting a nearby district's verified price for freight/transport cost.",
    "Derived + DES Index": "Estimated using the Delivered-Ex-Site (DES) index for this material category.",
    "Manual Override": "This price has been manually reviewed and set by our pricing team.",
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Price explanation</h3>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-400">Observations</p>
            <p className="font-medium text-slate-700">{current.observationCount}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Sources</p>
            <p className="font-medium text-slate-700">{current.sourceCount}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Price date</p>
            <p className="font-medium text-slate-700">{current.priceDate}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Confidence</p>
            <p className="font-medium text-slate-700">{current.confidence}</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-500">{confidenceExplanation[current.confidence]}</p>
      <p className="text-sm text-slate-500">{methodExplanation[current.methodLabel] || ""}</p>

      {current.anchorDistrictName ? (
        <p className="text-sm font-semibold text-[color:var(--posh-fg-muted)]">
          Estimated using nearby verified market data from <strong className="text-[color:var(--posh-fg)]">{current.anchorDistrictName}</strong>.
        </p>
      ) : null}

      {sources.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Source breakdown</p>
          <ul className="mt-2 space-y-1.5">
            {sources.map((source) => (
              <li key={source.tier} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{source.label}</span>
                <span className="font-medium text-slate-700">{source.sourceCount}</span>
              </li>
            ))}
          </ul>
          {sources.some((s) => s.attributionText) ? (
            <p className="mt-2 text-xs text-slate-400">
              {sources
                .filter((s) => s.attributionText)
                .map((s) => s.attributionText)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
