"use client";

// Small presentational badges shared across the District Price Intelligence
// panel (Phase 6A). Deliberately tiny/dumb components — all classification
// logic (method label, freshness, market position) is computed server-side
// or in lib/district-pricing.ts, never re-derived here.

import type { DistrictPriceMethodLabel } from "@/lib/district-pricing-types";

export function MethodBadge({ label }: { label: DistrictPriceMethodLabel }) {
  const isObserved = label === "Observed";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        isObserved
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
      title={isObserved ? "Based on directly observed prices" : "Estimated from nearby market data"}
    >
      {label}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: "HIGH" | "MEDIUM" | "LOW" }) {
  const styles: Record<string, string> = {
    HIGH: "border-emerald-200 bg-emerald-50 text-emerald-700",
    MEDIUM: "border-amber-200 bg-amber-50 text-amber-700",
    LOW: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[confidence]}`}>
      {confidence} confidence
    </span>
  );
}

export function FreshnessIndicator({ label, isStale }: { label: string; isStale: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${isStale ? "text-rose-600" : "text-slate-500"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isStale ? "bg-rose-500" : "bg-emerald-500"}`} aria-hidden />
      {isStale ? "STALE" : label}
    </span>
  );
}

export function MarketPositionBadge({
  marketPosition,
}: {
  marketPosition: { status: "BELOW" | "WITHIN" | "ABOVE"; diffPct: number } | null;
}) {
  if (!marketPosition) return null;
  const styles: Record<string, string> = {
    BELOW: "border-emerald-200 bg-emerald-50 text-emerald-700",
    WITHIN: "border-amber-200 bg-amber-50 text-amber-700",
    ABOVE: "border-rose-200 bg-rose-50 text-rose-700",
  };
  const label: Record<string, string> = {
    BELOW: "Below Market",
    WITHIN: "Within Market",
    ABOVE: "Above Market",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[marketPosition.status]}`}
    >
      {label[marketPosition.status]} ({marketPosition.diffPct > 0 ? "+" : ""}
      {marketPosition.diffPct.toFixed(1)}%)
    </span>
  );
}
