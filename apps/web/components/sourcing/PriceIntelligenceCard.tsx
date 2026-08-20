"use client";

import { TrendingDown, TrendingUp, Minus, AlertTriangle } from "lucide-react";

// Phase 8 — Price Intelligence panel.
// All figures come from the backend. Null values are never rendered as ₹0.

export type PriceIntelligenceCardProps = {
  priceIntelligence: {
    currentPrice: number | null;
    currentDate: string | null;
    averagePrice: number | null;
    vsAveragePct: number | null;
    freshness: "FRESH" | "RECENT" | "STALE" | "UNKNOWN";
    dataGaps: string[];
  };
  trend: {
    direction: "RISING" | "FALLING" | "STABLE" | "VOLATILE" | "INSUFFICIENT_DATA";
    periodChangePct: number | null;
    observationCount: number;
    confidence: string;
    dataGaps: string[];
  };
  confidence: {
    level: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
    factors: string[];
  };
  timing: {
    recommendation: "BUY_NOW" | "WAIT" | "MONITOR" | "INSUFFICIENT_DATA";
    reasons: string[];
  };
};

function inr(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "Not available";
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function TrendIcon({ direction }: { direction: string }) {
  if (direction === "RISING") return <TrendingUp className="h-4 w-4 text-[color:var(--posh-fg)]" />;
  if (direction === "FALLING") return <TrendingDown className="h-4 w-4 text-[color:var(--posh-fg)]" />;
  if (direction === "VOLATILE") return <AlertTriangle className="h-4 w-4 text-[color:var(--posh-fg)]" />;
  return <Minus className="h-4 w-4 text-slate-400" />;
}

// Mono badges: the actionable signal (BUY_NOW) is solid black, the advisory
// ones are outlined, and "no data" stays a faint chip.
const TIMING_BADGE: Record<string, string> = {
  BUY_NOW: "bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]",
  WAIT: "border border-[color:var(--posh-primary)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)]",
  MONITOR: "border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)]",
  INSUFFICIENT_DATA: "bg-[rgba(var(--posh-wash-rgb),0.04)] text-[color:var(--posh-fg-muted)]",
};

const TIMING_LABEL: Record<string, string> = {
  BUY_NOW: "Buy Now",
  WAIT: "Wait",
  MONITOR: "Monitor",
  INSUFFICIENT_DATA: "Insufficient data",
};

// Confidence uses black at decreasing opacity/weight instead of colour.
const CONFIDENCE_COLOR: Record<string, string> = {
  HIGH: "font-bold text-[color:var(--posh-fg)]",
  MEDIUM: "font-semibold text-[color:var(--posh-fg-muted)]",
  LOW: "font-medium text-[color:var(--posh-fg-muted)]",
  INSUFFICIENT_DATA: "font-medium text-[color:var(--posh-fg-muted)]",
};

export default function PriceIntelligenceCard({
  priceIntelligence,
  trend,
  confidence,
  timing,
}: PriceIntelligenceCardProps) {
  const { currentPrice, averagePrice, vsAveragePct, freshness } = priceIntelligence;

  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Price Intelligence</h2>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Current price</dt>
          <dd className="text-sm font-semibold text-slate-900">{inr(currentPrice)}</dd>
          <dd className="text-[11px] text-slate-400">
            {freshness === "STALE" ? "⚠ May be outdated" : freshness === "FRESH" ? "Today" : freshness === "RECENT" ? "Recent" : "Unknown date"}
          </dd>
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">30-day average</dt>
          <dd className="text-sm text-slate-800">{inr(averagePrice)}</dd>
          {vsAveragePct !== null && (
            <dd className={`text-[11px] font-medium ${vsAveragePct < 0 ? "text-[color:var(--posh-fg)]" : vsAveragePct > 0 ? "text-[color:var(--posh-fg)]" : "text-slate-500"}`}>
              {vsAveragePct >= 0 ? "+" : ""}{vsAveragePct.toFixed(1)}% vs avg
            </dd>
          )}
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Price trend</dt>
          <dd className="flex items-center gap-1 text-sm text-slate-800">
            <TrendIcon direction={trend.direction} />
            {trend.direction === "INSUFFICIENT_DATA" ? "Insufficient data" : trend.direction.charAt(0) + trend.direction.slice(1).toLowerCase()}
          </dd>
          {trend.periodChangePct !== null && (
            <dd className="text-[11px] text-slate-500">
              {trend.periodChangePct >= 0 ? "+" : ""}{trend.periodChangePct.toFixed(1)}% over period
            </dd>
          )}
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Data confidence</dt>
          <dd className={`text-sm font-semibold ${CONFIDENCE_COLOR[confidence.level] ?? "text-slate-600"}`}>
            {confidence.level === "INSUFFICIENT_DATA" ? "Insufficient" : confidence.level.charAt(0) + confidence.level.slice(1).toLowerCase()}
          </dd>
          {confidence.factors[0] && (
            <dd className="text-[11px] text-slate-400 truncate">{confidence.factors[0]}</dd>
          )}
        </div>
      </dl>

      {/* Buy-timing recommendation */}
      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <p className="mb-1 text-xs font-semibold text-slate-700">Timing recommendation</p>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${TIMING_BADGE[timing.recommendation] ?? TIMING_BADGE.INSUFFICIENT_DATA}`}>
          {TIMING_LABEL[timing.recommendation] ?? timing.recommendation}
        </span>
        {timing.reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {timing.reasons.slice(0, 2).map((r, i) => (
              <li key={i} className="text-xs text-slate-600">• {r}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
