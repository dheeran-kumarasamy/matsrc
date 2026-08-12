"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

interface PriceItem { name: string; price: number; change: number }

// FR-24: Live scrolling price ticker for top 10 materials — Posh editorial style
const ITEMS: PriceItem[] = [
  { name: "TMT Bar Fe-500D",   price: 62400, change: -1.2 },
  { name: "OPC Cement 53G",    price: 380,   change:  0.5 },
  { name: "River Sand",        price: 1800,  change: -0.8 },
  { name: "AAC Blocks",        price: 3200,  change:  1.1 },
  { name: "Structural Steel",  price: 58000, change: -0.3 },
  { name: "Fly Ash Bricks",    price: 5200,  change:  0.0 },
  { name: "Binding Wire",      price: 72000, change: -2.1 },
  { name: "MS Pipe",           price: 68000, change:  0.7 },
  { name: "GI Sheet",          price: 84000, change: -0.5 },
  { name: "Plywood 18mm",      price: 92,    change:  1.3 },
];

export default function PriceTicker() {
  // Duplicate array for seamless infinite loop
  const doubled = [...ITEMS, ...ITEMS];

  return (
    <div
      className="h-8 overflow-hidden flex items-center border-b"
      style={{
        background: "var(--posh-bg)",
        borderColor: "var(--posh-border)",
        color: "var(--posh-fg-muted)",
      }}
    >
      {/* Left label */}
      <span
        className="shrink-0 border-r px-4 text-[10px] uppercase tracking-[0.25em] font-medium"
        style={{ borderColor: "var(--posh-border)", color: "var(--posh-primary)" }}
      >
        Live Prices
      </span>

      {/* Scrolling track */}
      <div className="flex-1 overflow-hidden">
        <div className="flex animate-marquee-posh whitespace-nowrap gap-0">
          {doubled.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-2 px-6 text-xs border-r" style={{ borderColor: "var(--posh-border)" }}>
              <span style={{ color: "var(--posh-fg-muted)" }}>{item.name}</span>
              <span className="font-medium" style={{ color: "var(--posh-fg)" }}>
                ₹{item.price.toLocaleString("en-IN")}
              </span>
              {item.change !== 0 && (
                <span
                  className="flex items-center gap-0.5 text-[10px]"
                  style={{ color: item.change < 0 ? "#f87171" : "#4ade80" }}
                >
                  {item.change < 0 ? <TrendingDown size={9} /> : <TrendingUp size={9} />}
                  {Math.abs(item.change)}%
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

