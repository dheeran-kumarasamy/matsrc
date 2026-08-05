"use client";

import { useMemo, useState } from "react";
import type {
  ListingCompetitivenessRow,
  CategoryTrendRow,
  DistrictOpportunityRow,
} from "@/lib/market-intelligence-data";

const CONFIDENCE_BADGE_CLASSES: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-200 text-slate-600",
};

const MARKET_POSITION_BADGE_CLASSES: Record<string, string> = {
  MUCH_BELOW_MARKET: "bg-sky-100 text-sky-800",
  BELOW_MARKET: "bg-sky-50 text-sky-700",
  WITHIN_MARKET: "bg-emerald-100 text-emerald-700",
  ABOVE_MARKET: "bg-amber-50 text-amber-700",
  MUCH_ABOVE_MARKET: "bg-amber-100 text-amber-800",
};

const OPPORTUNITY_BADGE_CLASSES: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-200 text-slate-600",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function trackAnalyticsEvent(event: string, payload: Record<string, unknown> = {}) {
  // Best-effort client-side analytics tracking (spec §17). Reuses the
  // existing supplier proxy route so events land in the same backend the
  // rest of the app already logs to; failures are swallowed since analytics
  // must never affect the user-facing experience.
  try {
    void fetch("/api/supplier/analytics/price-intelligence-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...payload, at: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // no-op
  }
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type TabKey = "competitiveness" | "category-trend" | "district-opportunity";

type Props = {
  competitiveness: ListingCompetitivenessRow[];
  categoryTrend: CategoryTrendRow[];
  districtOpportunity: DistrictOpportunityRow[];
  hadError: boolean;
};

export function MarketIntelligenceReportView({
  competitiveness,
  categoryTrend,
  districtOpportunity,
  hadError,
}: Props) {
  const [tab, setTab] = useState<TabKey>("competitiveness");
  const [districtFilter, setDistrictFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("ALL");
  const [positionFilter, setPositionFilter] = useState<string>("ALL");

  const districts = useMemo(
    () => Array.from(new Set(competitiveness.map((r) => r.districtName))).sort(),
    [competitiveness]
  );
  const categories = useMemo(
    () => Array.from(new Set(competitiveness.map((r) => r.category))).sort(),
    [competitiveness]
  );

  const filteredCompetitiveness = useMemo(() => {
    return competitiveness.filter((row) => {
      if (districtFilter !== "ALL" && row.districtName !== districtFilter) return false;
      if (categoryFilter !== "ALL" && row.category !== categoryFilter) return false;
      if (confidenceFilter !== "ALL" && row.confidence !== confidenceFilter) return false;
      if (positionFilter !== "ALL" && row.marketPosition !== positionFilter) return false;
      return true;
    });
  }, [competitiveness, districtFilter, categoryFilter, confidenceFilter, positionFilter]);

  function handleTabChange(next: TabKey) {
    setTab(next);
    if (next === "competitiveness") trackAnalyticsEvent("supplier_price_intel_competitiveness_viewed");
    if (next === "category-trend") trackAnalyticsEvent("supplier_price_intel_category_trend_viewed");
    if (next === "district-opportunity") trackAnalyticsEvent("supplier_price_intel_opportunity_viewed");
  }

  return (
    <div className="space-y-6">
      <div className="panel p-6">
        <h1 className="text-3xl font-extrabold text-slate-900">Market Intelligence</h1>
        <p className="mt-1 text-slate-600">
          Aggregate district-wise market data to help you price competitively. All figures are aggregated
          market statistics — individual competitor listings, prices, and identities are never shown.
        </p>
      </div>

      {hadError ? (
        <div
          role="alert"
          className="panel border border-amber-300 bg-amber-50 p-5 text-amber-800"
        >
          <p className="font-semibold">Some market intelligence data couldn&apos;t be loaded.</p>
          <p className="text-sm">Showing whatever data is currently available. Please retry later.</p>
        </div>
      ) : null}

      <div className="panel overflow-hidden">
        <div role="tablist" aria-label="Market intelligence reports" className="flex flex-wrap gap-2 border-b border-slate-200 px-5 pt-4">
          {(
            [
              { key: "competitiveness", label: "Listing Competitiveness" },
              { key: "category-trend", label: "Category Trend" },
              { key: "district-opportunity", label: "District Opportunity" },
            ] as { key: TabKey; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => handleTabChange(t.key)}
              className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600 ${
                tab === t.key
                  ? "border-b-2 border-blue-600 text-blue-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "competitiveness" ? (
            <CompetitivenessTab
              rows={filteredCompetitiveness}
              districts={districts}
              categories={categories}
              districtFilter={districtFilter}
              categoryFilter={categoryFilter}
              confidenceFilter={confidenceFilter}
              positionFilter={positionFilter}
              onDistrictFilter={(v) => {
                setDistrictFilter(v);
                trackAnalyticsEvent("supplier_price_intel_district_changed", { district: v });
              }}
              onCategoryFilter={(v) => {
                setCategoryFilter(v);
                trackAnalyticsEvent("supplier_price_intel_category_changed", { category: v });
              }}
              onConfidenceFilter={setConfidenceFilter}
              onPositionFilter={setPositionFilter}
            />
          ) : null}

          {tab === "category-trend" ? <CategoryTrendTab rows={categoryTrend} /> : null}

          {tab === "district-opportunity" ? <DistrictOpportunityTab rows={districtOpportunity} /> : null}
        </div>
      </div>
    </div>
  );
}

function CompetitivenessTab({
  rows,
  districts,
  categories,
  districtFilter,
  categoryFilter,
  confidenceFilter,
  positionFilter,
  onDistrictFilter,
  onCategoryFilter,
  onConfidenceFilter,
  onPositionFilter,
}: {
  rows: ListingCompetitivenessRow[];
  districts: string[];
  categories: string[];
  districtFilter: string;
  categoryFilter: string;
  confidenceFilter: string;
  positionFilter: string;
  onDistrictFilter: (v: string) => void;
  onCategoryFilter: (v: string) => void;
  onConfidenceFilter: (v: string) => void;
  onPositionFilter: (v: string) => void;
}) {
  if (rows.length === 0 && districtFilter === "ALL" && categoryFilter === "ALL") {
    return (
      <EmptyState
        title="No listings to compare yet"
        body="We couldn't match any of your active listings to district market data yet. Add listings in categories that have market coverage, or check back soon as more districts are added."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect label="District" value={districtFilter} onChange={onDistrictFilter} options={districts} />
        <FilterSelect label="Category" value={categoryFilter} onChange={onCategoryFilter} options={categories} />
        <FilterSelect
          label="Confidence"
          value={confidenceFilter}
          onChange={onConfidenceFilter}
          options={["HIGH", "MEDIUM", "LOW"]}
        />
        <FilterSelect
          label="Market Position"
          value={positionFilter}
          onChange={onPositionFilter}
          options={["MUCH_BELOW_MARKET", "BELOW_MARKET", "WITHIN_MARKET", "ABOVE_MARKET", "MUCH_ABOVE_MARKET"]}
        />
        <button
          onClick={() => {
            trackAnalyticsEvent("supplier_price_intel_csv_export", { report: "competitiveness" });
            downloadCsv(
              "listing-competitiveness.csv",
              rows.map((r) => ({
                Listing: r.listingName,
                Category: r.category,
                District: r.districtName,
                CurrentSellingPrice: r.currentSellingPrice,
                MarketMedian: r.marketMedian,
                P25: r.p25 ?? "",
                P75: r.p75 ?? "",
                Diff: r.diff,
                DiffPct: r.diffPct,
                MarketPosition: r.marketPositionLabel,
                Confidence: r.confidence,
                Method: r.method,
                ObservationCount: r.observationCount,
                TrendDirection: r.trendDirection ?? "",
                LastUpdated: r.lastUpdated,
                SuggestedConservative: r.suggestedBand.conservative,
                SuggestedCompetitive: r.suggestedBand.competitive,
                SuggestedPremium: r.suggestedBand.premium,
                OpportunityLevel: r.opportunity.level,
              }))
            );
          }}
          className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
        >
          Export CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No listings match these filters" body="Try adjusting or clearing the filters above." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Listing</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">District</th>
                <th className="py-2 pr-3">Your Price</th>
                <th className="py-2 pr-3">Market Median</th>
                <th className="py-2 pr-3">P25 / P75</th>
                <th className="py-2 pr-3">Diff %</th>
                <th className="py-2 pr-3">Position</th>
                <th className="py-2 pr-3">Confidence</th>
                <th className="py-2 pr-3">Trend</th>
                <th className="py-2 pr-3">Suggested Range</th>
                <th className="py-2 pr-3">Opportunity</th>
                <th className="py-2 pr-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.listingId}:${row.districtCode}`} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-semibold text-slate-900">{row.listingName}</td>
                  <td className="py-2 pr-3 text-slate-600">{row.category}</td>
                  <td className="py-2 pr-3 text-slate-600">{row.districtName}</td>
                  <td className="py-2 pr-3 text-slate-800">{formatCurrency(row.currentSellingPrice)}</td>
                  <td className="py-2 pr-3 text-slate-800">{formatCurrency(row.marketMedian)}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {row.p25 !== null && row.p75 !== null
                      ? `${formatCurrency(row.p25)} – ${formatCurrency(row.p75)}`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-slate-800">
                    {row.diffPct > 0 ? "+" : ""}
                    {row.diffPct.toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        MARKET_POSITION_BADGE_CLASSES[row.marketPosition]
                      }`}
                    >
                      {row.marketPositionLabel}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONFIDENCE_BADGE_CLASSES[row.confidence]}`}>
                      {row.confidence}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{row.trendDirection ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {formatCurrency(row.suggestedBand.conservative)} – {formatCurrency(row.suggestedBand.premium)}
                    <span className="ml-1 text-xs text-slate-400">(guidance only)</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${OPPORTUNITY_BADGE_CLASSES[row.opportunity.level]}`}
                      title={row.opportunity.explanation}
                    >
                      {row.opportunity.level}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{new Date(row.lastUpdated).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CategoryTrendTab({ rows }: { rows: CategoryTrendRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No category trend data yet"
        body="Trend history builds up as more monthly market data becomes available for your listing categories."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => {
            trackAnalyticsEvent("supplier_price_intel_csv_export", { report: "category-trend" });
            downloadCsv(
              "category-trend.csv",
              rows.map((r) => ({
                Category: r.category,
                District: r.districtName,
                ChangePct: r.changePct ?? "",
                HighestMonth: r.highestMonth?.monthStart ?? "",
                HighestMedian: r.highestMonth?.medianPerBaseUnit ?? "",
                LowestMonth: r.lowestMonth?.monthStart ?? "",
                LowestMedian: r.lowestMonth?.medianPerBaseUnit ?? "",
                VolatilityPct: r.volatilityPct ?? "",
                Confidence: r.confidence,
                ObservationCount: r.observationCount,
              }))
            );
          }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">District</th>
              <th className="py-2 pr-3">12-Month Change</th>
              <th className="py-2 pr-3">Highest Month</th>
              <th className="py-2 pr-3">Lowest Month</th>
              <th className="py-2 pr-3">Volatility</th>
              <th className="py-2 pr-3">Confidence</th>
              <th className="py-2 pr-3">Observations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.category}:${row.districtCode}`} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-semibold text-slate-900">{row.category}</td>
                <td className="py-2 pr-3 text-slate-600">{row.districtName}</td>
                <td className="py-2 pr-3 text-slate-800">
                  {row.changePct !== null ? `${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(1)}%` : "—"}
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {row.highestMonth ? `${row.highestMonth.monthStart} · ${formatCurrency(row.highestMonth.medianPerBaseUnit)}` : "—"}
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {row.lowestMonth ? `${row.lowestMonth.monthStart} · ${formatCurrency(row.lowestMonth.medianPerBaseUnit)}` : "—"}
                </td>
                <td className="py-2 pr-3 text-slate-600">{row.volatilityPct !== null ? `${row.volatilityPct}%` : "—"}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONFIDENCE_BADGE_CLASSES[row.confidence]}`}>
                    {row.confidence}
                  </span>
                </td>
                <td className="py-2 pr-3 text-slate-600">{row.observationCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DistrictOpportunityTab({ rows }: { rows: DistrictOpportunityRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No district opportunities found"
        body="We couldn't find districts with market demand for your categories that you aren't already covering. Check back as more market data and districts are added."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => {
            trackAnalyticsEvent("supplier_price_intel_csv_export", { report: "district-opportunity" });
            downloadCsv(
              "district-opportunity.csv",
              rows.map((r) => ({
                District: r.districtName,
                Category: r.category,
                MedianPrice: r.medianPrice,
                Trend: r.trendDirection ?? "",
                Confidence: r.confidence,
                OpportunityScore: r.opportunityScore,
                OpportunityLevel: r.opportunityLevel,
                Reason: r.reason,
              }))
            );
          }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">District</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Median Price</th>
              <th className="py-2 pr-3">Trend</th>
              <th className="py-2 pr-3">Confidence</th>
              <th className="py-2 pr-3">Opportunity</th>
              <th className="py-2 pr-3">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.districtCode}:${row.category}:${idx}`} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-semibold text-slate-900">{row.districtName}</td>
                <td className="py-2 pr-3 text-slate-600">{row.category}</td>
                <td className="py-2 pr-3 text-slate-800">{formatCurrency(row.medianPrice)}</td>
                <td className="py-2 pr-3 text-slate-600">{row.trendDirection ?? "—"}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONFIDENCE_BADGE_CLASSES[row.confidence]}`}>
                    {row.confidence}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${OPPORTUNITY_BADGE_CLASSES[row.opportunityLevel]}`}>
                    {row.opportunityLevel} ({row.opportunityScore})
                  </span>
                </td>
                <td className="py-2 pr-3 text-slate-500">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col text-xs font-semibold text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
      >
        <option value="ALL">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
      <p className="text-lg font-bold text-slate-800">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  );
}
