"use client";

// Phase 8 — Price history + forecast chart for the sourcing assistant.
// Uses recharts (already a project dependency — see MarketTrendChart.tsx).
// Clearly labels historical vs forecast data; never implies forecast = observed.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PriceHistoryChartProps = {
  /** Historical daily price points (from PricingDistrictPriceDaily). */
  points: Array<{ date: string; price: number; confidence: string }>;
  /** Forecast points from computeForecast(). Empty when insufficient data. */
  forecastPoints: Array<{ date: string; price: number; lower: number; upper: number }>;
  /** Current 30-day average line value. Null when unavailable. */
  averagePrice: number | null;
  method: string;
};

function formatInr(v: number): string {
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function shortDate(iso: string): string {
  // Shows "12 Aug" style labels.
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function PriceHistoryChart({
  points,
  forecastPoints,
  averagePrice,
  method,
}: PriceHistoryChartProps) {
  if (points.length === 0) {
    return (
      <section className="posh-card p-5">
        <h2 className="posh-card-title mb-1 text-base">Price History</h2>
        <p className="posh-muted text-xs">
          Not enough historical data to display a reliable price trend.
        </p>
      </section>
    );
  }

  // Combine historical + forecast into a single series for the chart.
  // Forecast values are stored in separate fields so the chart can style them differently.
  type ChartPoint = {
    date: string;
    price?: number;
    forecastPrice?: number;
    forecastLower?: number;
    forecastUpper?: number;
  };

  const chartData: ChartPoint[] = [
    ...points.map((p) => ({ date: shortDate(p.date), price: p.price })),
    ...forecastPoints.map((p) => ({
      date: shortDate(p.date),
      forecastPrice: p.price,
      forecastLower: p.lower,
      forecastUpper: p.upper,
    })),
  ];

  const hasForecast = forecastPoints.length > 0;

  return (
    <section className="posh-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="posh-card-title text-base">Price History</h2>
        {/* Observed vs forecast is distinguished by fill/dash, not colour —
            the whole surface is black & white. */}
        <div className="posh-label flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-4 rounded-sm bg-[color:var(--posh-primary)]" />
            Observed
          </span>
          {hasForecast && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded-sm border border-[color:var(--posh-primary)] bg-[color:var(--posh-bg-card)]" />
              Forecast
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--posh-border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }}
            tickLine={false}
            stroke="var(--posh-primary)"
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }}
            tickLine={false}
            tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
            width={44}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatInr(value),
              name === "price" ? "Observed" : "Forecast",
            ]}
            labelStyle={{ fontSize: 11, color: "var(--posh-fg-muted)" }}
            itemStyle={{ color: "var(--posh-fg-muted)" }}
            contentStyle={{ fontSize: 11 }}
          />
          {averagePrice !== null && (
            <ReferenceLine
              y={averagePrice}
              stroke="var(--posh-primary)"
              strokeDasharray="4 3"
              label={{ value: "Avg", position: "right", fontSize: 10, fill: "var(--posh-fg-muted)" }}
            />
          )}
          {/* Historical — solid black line with a light black wash. */}
          <Area
            type="monotone"
            dataKey="price"
            stroke="var(--posh-primary)"
            fill="var(--posh-border)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          {/* Forecast band — same black, dashed and unfilled so it is clearly
              distinguished from observed data without using colour. */}
          {hasForecast && (
            <Area
              type="monotone"
              dataKey="forecastPrice"
              stroke="var(--posh-primary)"
              fill="rgba(var(--posh-wash-rgb),0.06)"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      {hasForecast && (
        <p className="mt-2 text-[11px] font-medium text-[color:var(--posh-fg-muted)]">
          Forecast: {method} · Not a guaranteed future price.
        </p>
      )}
    </section>
  );
}
