"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface PriceItem { name: string; price: number; change: number }

// FR-24: Live scrolling price ticker for top 10 materials
export default function PriceTicker() {
  const [items, setItems] = useState<PriceItem[]>([
    { name: "TMT Bar Fe-500D", price: 62400, change: -1.2 },
    { name: "OPC Cement 53G", price: 380, change: 0.5 },
    { name: "River Sand", price: 1800, change: -0.8 },
    { name: "AAC Blocks", price: 3200, change: 1.1 },
    { name: "Structural Steel", price: 58000, change: -0.3 },
    { name: "Fly Ash Bricks", price: 5200, change: 0.0 },
    { name: "Binding Wire", price: 72000, change: -2.1 },
    { name: "MS Pipe", price: 68000, change: 0.7 },
    { name: "GI Sheet", price: 84000, change: -0.5 },
    { name: "Plywood 18mm", price: 92, change: 1.3 },
  ]);

  return (
    <div className="bg-gray-900 text-white text-xs overflow-hidden h-7 flex items-center">
      <span className="bg-accent-500 px-3 h-full flex items-center font-semibold shrink-0">LIVE PRICES</span>
      <div className="flex animate-marquee gap-8 ml-4 whitespace-nowrap">
        {[...items, ...items].map((item, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="text-gray-300">{item.name}</span>
            <span className="font-semibold">₹{item.price.toLocaleString("en-IN")}</span>
            <span className={item.change < 0 ? "text-red-400 flex items-center" : item.change > 0 ? "text-green-400 flex items-center" : "text-gray-400"}>
              {item.change < 0 ? <TrendingDown size={10} /> : item.change > 0 ? <TrendingUp size={10} /> : null}
              {item.change !== 0 && `${Math.abs(item.change)}%`}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
