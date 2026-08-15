"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Period = 7 | 30 | 90;

type PriceEntry = { price: number; recordedAt: string };

// FR-23: Price movement chart with 7/30/90-day trend (real PricePoint data)
export default function PriceChart({ priceHistory }: { priceHistory: PriceEntry[] }) {
  const [period, setPeriod] = useState<Period>(30);

  const data = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    return priceHistory
      .filter((p) => new Date(p.recordedAt) >= cutoff)
      .map((p, i) => ({
        day: i + 1,
        date: new Date(p.recordedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        price: p.price,
      }))
      .reverse(); // oldest first for chart
  }, [priceHistory, period]);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {([7, 30, 90] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={period === p ? "posh-chip-active" : "posh-chip"}
          >
            {p}D
          </button>
        ))}
      </div>
      {data.length === 0 ? (
        <div className="posh-muted flex h-[200px] items-center justify-center text-sm">
          No price history for this period
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={200}>
        {/* Black-and-white chart palette — series, axes and grid all render in
            black so charts match the site-wide monochrome design. */}
        <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#00000012" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#000000" }} tickLine={false} stroke="#000000" />
          <YAxis
            tick={{ fontSize: 10, fill: "#000000" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Price"]}
            labelStyle={{ color: "#000000" }}
            itemStyle={{ color: "#000000" }}
          />
          <Line type="monotone" dataKey="price" stroke="#000000" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
