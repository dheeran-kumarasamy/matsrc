"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Period = 7 | 30 | 90;

// FR-23: Price movement chart with 7/30/90-day trend
export default function PriceChart({ productSlug }: { productSlug: string }) {
  const [period, setPeriod] = useState<Period>(30);

  // Placeholder data — replaced by API call in production
  const data = Array.from({ length: period }, (_, i) => ({
    day: i + 1,
    price: 60000 + Math.round((Math.random() - 0.5) * 5000),
  }));

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {([7, 30, 90] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${period === p ? "bg-brand-500 text-white border-brand-500" : "border-gray-200 text-gray-500 hover:border-brand-500"}`}
          >
            {p}D
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Price"]} labelFormatter={(l) => `Day ${l}`} />
          <Line type="monotone" dataKey="price" stroke="#1a4f8a" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
