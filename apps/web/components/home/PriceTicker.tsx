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
  return (
    // Layout matches the Lovable design exactly: a STATIC (not fixed/sticky)
    // full-bleed band that sits directly BELOW the hero section and ABOVE the
    // rest of the page content — not a strip pinned above the header.
    // Lovable markup: <section className="border-y border-border/60 py-5">
    // with a `w-max` marquee track inside, so the band spans the full viewport
    // width while the items scroll continuously. Identical on desktop and
    // mobile (no breakpoint-specific behaviour in Lovable), and `overflow-hidden`
    // guarantees the off-screen half of the duplicated track never introduces
    // horizontal page scrolling.
    <section
      className="overflow-hidden border-y py-5"
      style={{
        background: "var(--posh-bg)",
        borderColor: "var(--posh-border)",
        color: "var(--posh-fg)",
      }}
      aria-label="Live material prices"
    >
      <div className="flex w-max animate-marquee-posh">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex shrink-0" aria-hidden={dup === 1}>
            {ITEMS.map((item) => (
              <span
                key={`${dup}-${item.name}`}
                className="flex items-baseline gap-3 whitespace-nowrap px-8 text-sm"
              >
                <span style={{ color: "var(--posh-fg-muted)" }}>{item.name}</span>
                <span style={{ color: "var(--posh-fg)" }}>
                  ₹{item.price.toLocaleString("en-IN")}
                </span>
                {item.change !== 0 && (
                  <span
                    className="flex items-center gap-0.5 text-xs"
                    style={{ color: "var(--posh-primary)" }}
                  >
                    {item.change < 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                    {item.change > 0 ? "+" : "-"}
                    {Math.abs(item.change)}%
                  </span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

