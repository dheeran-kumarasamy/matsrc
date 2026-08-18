"use client";

import { useEffect, useState } from "react";

interface PriceItem { name: string; price: number }

// FR-24: Live scrolling price ticker for top 10 materials — Posh editorial style.
//
// P0 fix (Phase 9): this previously rendered a fully hardcoded array of 10
// fake material names/prices/% changes with no underlying data source (the
// "live" ticker was not live at all, and the ±% change figures were
// mathematically fabricated for presentation). It now fetches real,
// currently-active listing prices from the same supplier-listings source the
// /products catalogue uses (via /api/proxy/public/ticker →
// getSupplierListings()). There is no real day-over-day price-history feed
// wired into this app, so the fabricated % change indicator has been removed
// entirely rather than replaced with another invented number.
const TICKER_API_URL = "/api/proxy/public/ticker";

export default function PriceTicker() {
  const [items, setItems] = useState<PriceItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(TICKER_API_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load ticker prices");
        const data = (await response.json()) as PriceItem[];
        if (!cancelled) setItems(data);
      } catch {
        if (!cancelled) setItems([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

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
            {items.map((item) => (
              <span
                key={`${dup}-${item.name}`}
                className="flex items-baseline gap-3 whitespace-nowrap px-8 text-sm"
              >
                <span style={{ color: "var(--posh-fg-muted)" }}>{item.name}</span>
                <span style={{ color: "var(--posh-fg)" }}>
                  From ₹{item.price.toLocaleString("en-IN")}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

