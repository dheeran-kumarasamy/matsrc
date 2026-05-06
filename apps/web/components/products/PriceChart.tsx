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
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${period === p ? "bg-blue-700 text-white border-blue-700" : "border-slate-200 text-slate-500 hover:border-blue-700"}`}
          >
            {p}D
          </button>
        ))}
      </div>
      {data.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-slate-300 text-sm">
          No price history for this period
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Price"]} />
          <Line type="monotone" dataKey="price" stroke="#1a4f8a" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
