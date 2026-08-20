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
          ? "border-[color:var(--posh-primary)] bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]"
          : "border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)]"
      }`}
      title={isObserved ? "Based on directly observed prices" : "Estimated from nearby market data"}
    >
      {label}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: "HIGH" | "MEDIUM" | "LOW" }) {
  // Monochrome: confidence steps down from solid black to a faint chip.
  const styles: Record<string, string> = {
    HIGH: "border-[color:var(--posh-primary)] bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]",
    MEDIUM: "border-[color:var(--posh-primary)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)]",
    LOW: "border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg-muted)]",
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
      className={`inline-flex items-center gap-1 text-xs font-medium ${isStale ? "font-bold text-[color:var(--posh-fg)]" : "text-[color:var(--posh-fg-muted)]"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isStale ? "bg-[color:var(--posh-primary)]" : "bg-[rgba(var(--posh-wash-rgb),0.12)]"}`} aria-hidden />
      {isStale ? "STALE" : label}
    </span>
  );
}

// Phase 6F — Geographic Pricing Hierarchy badge. Explicitly discloses
// whether the displayed price is district-specific or a broader
// state/national reference — never lets a state reference be mistaken for
// a district price (spec §18/§20/§43 product-language rules).
export function GeographyLevelBadge({
  geographyLevel,
  stateName,
  districtName,
}: {
  geographyLevel: "DISTRICT" | "STATE" | "NATIONAL";
  stateName?: string | null;
  districtName?: string | null;
}) {
  if (geographyLevel === "DISTRICT") {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
        {districtName ? `${districtName} district price` : "District price"}
      </span>
    );
  }
  if (geographyLevel === "STATE") {
    return (
      <span
        className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700"
        title="District-specific pricing is unavailable; this is a state-wide reference price."
      >
        {stateName ? `${stateName} state reference` : "State reference"}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600"
      title="District- and state-specific pricing is unavailable; this is a national reference price."
    >
      National reference
    </span>
  );
}

export function MarketPositionBadge({
  marketPosition,
}: {
  marketPosition: { status: "BELOW" | "WITHIN" | "ABOVE"; diffPct: number } | null;
}) {
  if (!marketPosition) return null;
  // Monochrome: "Below market" (the good outcome) is the solid-black chip.
  const styles: Record<string, string> = {
    BELOW: "border-[color:var(--posh-primary)] bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]",
    WITHIN: "border-[color:var(--posh-primary)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)]",
    ABOVE: "border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg-muted)]",
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
