import Link from "next/link";
import type { MarketIntelligenceSummary } from "@/lib/market-intelligence-data";

const CONFIDENCE_BADGE_CLASSES: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-200 text-slate-600",
  "—": "bg-slate-200 text-slate-600",
};

type Props = {
  summary: MarketIntelligenceSummary;
};

// Phase 6B — Supplier Dashboard "Market Intelligence" summary section (spec
// §1). Read-only KPI cards computed server-side from aggregate market data
// only (see lib/market-intelligence-data.ts) — no competitor identity or
// price is ever surfaced here. Cards link through to the full report page.
export function MarketIntelligenceSummaryWidget({ summary }: Props) {
  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "Active Listings", value: String(summary.activeListings) },
    { label: "Listings Compared", value: String(summary.listingsCompared) },
    { label: "Competitive Listings", value: String(summary.competitiveListings), hint: "Within market range" },
    { label: "Overpriced Listings", value: String(summary.overpricedListings), hint: "Above market range" },
    { label: "Underpriced Listings", value: String(summary.underpricedListings), hint: "Below market range" },
    { label: "Districts Covered", value: String(summary.districtsCovered) },
    { label: "Categories Covered", value: String(summary.categoriesCovered) },
    { label: "Avg. Market Position", value: summary.averageMarketPositionLabel },
    { label: "Avg. Confidence", value: summary.averageConfidence },
    {
      label: "Last Updated",
      value: summary.lastUpdated ? new Date(summary.lastUpdated).toLocaleDateString("en-IN") : "—",
    },
  ];

  return (
    <div className="panel overflow-hidden" aria-label="Market Intelligence summary">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-7 py-5">
        <div>
          <h3 className="text-4xl font-extrabold text-slate-900">Market Intelligence</h3>
          <p className="mt-1 text-lg text-slate-600">
            How your listings compare against aggregate district market data.
          </p>
        </div>
        <Link
          href="/reports/market-intelligence"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
        >
          View Full Report
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 px-7 py-6 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <Link
            key={card.label}
            href="/reports/market-intelligence"
            className="rounded-xl border border-slate-200 p-4 transition hover:border-blue-300 hover:bg-blue-50/40 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
            <p
              className={`mt-2 text-2xl font-extrabold ${
                card.label === "Avg. Confidence"
                  ? `inline-block rounded-full px-3 py-0.5 text-lg ${
                      CONFIDENCE_BADGE_CLASSES[card.value] ?? CONFIDENCE_BADGE_CLASSES.LOW
                    }`
                  : "text-slate-900"
              }`}
            >
              {card.value}
            </p>
            {card.hint ? <p className="mt-1 text-xs text-slate-500">{card.hint}</p> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
