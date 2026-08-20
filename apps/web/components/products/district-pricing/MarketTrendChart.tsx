"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

import type { DistrictPricePanelTrendPoint } from "@/lib/district-pricing-types";

type RangeKey = "1M" | "3M" | "6M" | "12M" | "ALL";
const RANGE_MONTHS: Record<RangeKey, number | null> = { "1M": 1, "3M": 3, "6M": 6, "12M": 12, ALL: null };

// 12-month district trend chart (Median/P25/P75/observation count are not
// all present on the monthly rollup — median + confidence + day count are
// what PricingTrendMonthly stores; band overlay uses medianPerBaseUnit only
// since P25/P75 are a daily-row concept, not tracked monthly). Reuses
// recharts (already a dependency) — no new chart library introduced.
export default function MarketTrendChart({
  trend,
  onRangeChange,
}: {
  trend: DistrictPricePanelTrendPoint[];
  onRangeChange?: (range: RangeKey) => void;
}) {
  const [range, setRange] = useState<RangeKey>("12M");

  const filtered = useMemo(() => {
    const months = RANGE_MONTHS[range];
    if (months === null) return trend;
    return trend.slice(-months);
  }, [trend, range]);

  const chartData = filtered.map((p) => ({
    date: new Date(p.monthStart).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    median: p.medianPerBaseUnit,
    confidence: p.confidence,
  }));

  function handleRangeChange(key: RangeKey) {
    setRange(key);
    onRangeChange?.(key);
  }

  if (trend.length === 0) {
    return (
      <div className="posh-muted flex h-[160px] items-center justify-center rounded-xl border border-[color:var(--posh-border)] bg-[rgba(240,232,216,0.03)] text-sm">
        Not enough history yet to show a price trend.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="posh-card-title text-base">Market trend</h3>
        <div role="tablist" aria-label="Trend range" className="flex gap-1 rounded-full bg-[rgba(240,232,216,0.05)] p-1">
          {(Object.keys(RANGE_MONTHS) as RangeKey[]).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={range === key}
              onClick={() => handleRangeChange(key)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                range === key ? "bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]" : "text-[color:var(--posh-fg-muted)] hover:text-[color:var(--posh-fg)]"
              }`}
            >
              {key === "ALL" ? "All" : key}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            {/* Monochrome chart palette (site-wide black & white design). */}
            <CartesianGrid strokeDasharray="3 3" stroke="var(--posh-border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }} tickLine={false} stroke="var(--posh-primary)" />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Median"]}
              labelStyle={{ color: "var(--posh-fg-muted)" }}
              itemStyle={{ color: "var(--posh-fg-muted)" }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--posh-fg-muted)" }} />
            <Line type="monotone" dataKey="median" name="Median price" stroke="var(--posh-primary)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
