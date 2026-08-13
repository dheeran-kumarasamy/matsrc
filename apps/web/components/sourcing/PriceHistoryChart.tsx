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
      <section className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Price History</h2>
        <p className="text-xs text-slate-400">
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
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Price History</h2>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="h-2 w-4 rounded-sm bg-blue-500 opacity-80" />
            Observed
          </span>
          {hasForecast && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded-sm bg-amber-400 opacity-60" />
              Forecast
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
            width={44}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatInr(value),
              name === "price" ? "Observed" : "Forecast",
            ]}
            labelStyle={{ fontSize: 11 }}
            contentStyle={{ fontSize: 11 }}
          />
          {averagePrice !== null && (
            <ReferenceLine
              y={averagePrice}
              stroke="#94a3b8"
              strokeDasharray="4 3"
              label={{ value: "Avg", position: "right", fontSize: 10, fill: "#94a3b8" }}
            />
          )}
          {/* Historical */}
          <Area
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            fill="#eff6ff"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          {/* Forecast band */}
          {hasForecast && (
            <Area
              type="monotone"
              dataKey="forecastPrice"
              stroke="#f59e0b"
              fill="#fef3c7"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      {hasForecast && (
        <p className="mt-2 text-[11px] text-slate-400">
          Forecast: {method} · Not a guaranteed future price.
        </p>
      )}
    </section>
  );
}
