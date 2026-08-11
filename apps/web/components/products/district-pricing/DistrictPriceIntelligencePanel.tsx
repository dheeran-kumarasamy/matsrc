"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { builderApiGet, ApiError } from "@/lib/api";
import { recordPriceIntelligenceEvent } from "@/lib/interest-events";
import type { DistrictPricingPanelResponse } from "@/lib/district-pricing-types";
import { ConfidenceBadge, FreshnessIndicator, GeographyLevelBadge, MarketPositionBadge, MethodBadge } from "./badges";
import DistrictSelector, { districtSelectorStorageKey } from "./DistrictSelector";
import MarketTrendChart from "./MarketTrendChart";
import NearbyDistrictComparisonTable from "./NearbyDistrictComparisonTable";
import PriceExplanationCard from "./PriceExplanationCard";
import HistoricalPriceContext from "./HistoricalPriceContext";
import {
  PriceIntelligenceEmptyState,
  PriceIntelligenceErrorState,
  PriceIntelligenceLoadingState,
} from "./states";

// Top-level collapsible container for the Builder PDP "District Price
// Intelligence" panel (Phase 6A). Additive — sits alongside (not instead
// of) the existing cross-supplier PriceIntelligenceSection. Owns loading /
// error / empty states and lazy-mounts the heavier sub-sections (trend
// chart, comparison table, historical context) only once expanded, so it
// never blocks the PDP's initial render / LCP.
export default function DistrictPriceIntelligencePanel({
  canonicalProductId,
  basePrice,
  onRequestQuote,
}: {
  canonicalProductId: string;
  basePrice?: number;
  onRequestQuote?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<DistrictPricingPanelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const hasOpenedOnce = useRef(false);

  const fetchData = useCallback(
    (districtCode?: string | null) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (districtCode) params.set("district", districtCode);
      if (basePrice) params.set("listingPrice", String(basePrice));
      const qs = params.toString();

      builderApiGet<DistrictPricingPanelResponse>(
        `/products/${canonicalProductId}/district-pricing${qs ? `?${qs}` : ""}`
      )
        .then((result) => {
          setData(result);
          if (result.selectedDistrict) {
            setSelectedDistrict(result.selectedDistrict.code);
            if (typeof window !== "undefined") {
              window.localStorage.setItem(districtSelectorStorageKey(canonicalProductId), result.selectedDistrict.code);
            }
          }
        })
        .catch((err) => {
          setError(err instanceof ApiError ? err.message : "Failed to load district price intelligence");
        })
        .finally(() => setLoading(false));
    },
    [canonicalProductId, basePrice]
  );

  useEffect(() => {
    if (!expanded || hasOpenedOnce.current) return;
    hasOpenedOnce.current = true;
    recordPriceIntelligenceEvent(canonicalProductId, "PANEL_OPENED");

    let initialDistrict: string | null = null;
    if (typeof window !== "undefined") {
      initialDistrict = window.localStorage.getItem(districtSelectorStorageKey(canonicalProductId));
    }
    fetchData(initialDistrict);
  }, [expanded, canonicalProductId, fetchData]);

  function handleDistrictChange(code: string) {
    setSelectedDistrict(code);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(districtSelectorStorageKey(canonicalProductId), code);
    }
    recordPriceIntelligenceEvent(canonicalProductId, "DISTRICT_CHANGED", { district: code });
    fetchData(code);
  }

  function handleRetry() {
    fetchData(selectedDistrict);
  }

  function handleTrendRangeChange(range: string) {
    recordPriceIntelligenceEvent(canonicalProductId, "TREND_RANGE_CHANGED", { range });
  }

  function handleComparisonViewed() {
    recordPriceIntelligenceEvent(canonicalProductId, "COMPARISON_VIEWED");
  }

  function handleCsvDownloaded() {
    recordPriceIntelligenceEvent(canonicalProductId, "CSV_DOWNLOADED");
  }

  function handleRequestQuote() {
    recordPriceIntelligenceEvent(canonicalProductId, "QUOTE_REQUESTED");
    onRequestQuote?.();
  }

  return (
    <div className="panel p-0 overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="district-price-intelligence-content"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-900">District Price Intelligence</h2>
          <p className="mt-1 text-sm text-slate-500">
            Verified market prices for this material in your district, powered by Matsrc price intelligence.
          </p>
        </div>
        <span className="text-slate-400" aria-hidden>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded ? (
        <div id="district-price-intelligence-content" className="border-t border-slate-100 p-5">
          {loading ? <PriceIntelligenceLoadingState /> : null}

          {!loading && error ? (
            <PriceIntelligenceErrorState message={error} onRetry={handleRetry} onRequestQuote={handleRequestQuote} />
          ) : null}

          {!loading && !error && data && !data.resolved ? (
            <PriceIntelligenceEmptyState
              reason={data.emptyReason ?? "NO_SKU_MATCH"}
              onRequestQuote={handleRequestQuote}
            />
          ) : null}

          {!loading && !error && data && data.resolved && data.current ? (
            <div className="space-y-6">
              {data.availableDistricts.length > 1 ? (
                <DistrictSelector
                  options={data.availableDistricts}
                  selectedCode={selectedDistrict}
                  onChange={handleDistrictChange}
                  isFallback={data.isDistrictFallback}
                />
              ) : null}

              {/* Current price summary */}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <GeographyLevelBadge
                    geographyLevel={data.current.geographyLevel}
                    stateName={data.current.geographyStateName}
                    districtName={data.selectedDistrict?.name}
                  />
                  <MethodBadge label={data.current.methodLabel} />
                  <ConfidenceBadge confidence={data.current.confidence} />
                  <FreshnessIndicator label={data.current.freshnessLabel} isStale={data.current.isStale} />
                  <MarketPositionBadge marketPosition={data.marketPosition} />
                </div>
                {data.current.isGeographyFallback ? (
                  <p className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                    State-level reference used because district-specific pricing is unavailable for{" "}
                    {data.selectedDistrict?.name ?? "this district"}.
                  </p>
                ) : null}
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-400">Current market price</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">
                      ₹{data.current.medianPerBaseUnit.toLocaleString("en-IN")}
                      <span className="ml-1 text-xs font-normal text-slate-400">/{data.current.baseUnit}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Today&apos;s range</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {data.current.minPerBaseUnit !== null && data.current.maxPerBaseUnit !== null
                        ? `₹${data.current.minPerBaseUnit.toLocaleString("en-IN")} - ₹${data.current.maxPerBaseUnit.toLocaleString("en-IN")}`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">P25 / P75</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {data.current.p25PerBaseUnit !== null && data.current.p75PerBaseUnit !== null
                        ? `₹${data.current.p25PerBaseUnit.toLocaleString("en-IN")} / ₹${data.current.p75PerBaseUnit.toLocaleString("en-IN")}`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Observations / Sources</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {data.current.observationCount} / {data.current.sourceCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Trend chart */}
              <MarketTrendChart trend={data.trend} onRangeChange={handleTrendRangeChange} />

              {/* Nearby district comparison */}
              <NearbyDistrictComparisonTable
                rows={data.nearbyDistricts}
                onView={handleComparisonViewed}
                onExport={handleCsvDownloaded}
              />

              {/* Price explanation */}
              <PriceExplanationCard current={data.current} sources={data.sourceBreakdown} />

              {/* Historical purchase context */}
              <HistoricalPriceContext historicalPurchase={data.historicalPurchase} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
