"use client";

import { useEffect, useState } from "react";

interface PriceItem { name: string; price: number }

const TICKER_API_URL = "/api/proxy/public/ticker";

// Live Price Scroller — compact market-information strip that sits in the
// header immediately to the right of the Buildohub logo, replacing the
// header search bar / Browse Materials link (see SiteHeader.tsx). Fetches
// the same real, currently-active listing prices as the rest of the site
// (via /api/proxy/public/ticker → getSupplierListings()) — no fabricated
// numbers or % changes.
//
// Styled to read as a refined financial/procurement strip rather than an
// advertising ticker: restrained charcoal/slate typography, a subtle olive
// accent, quiet separators, and a slow (90s) marquee that respects
// prefers-reduced-motion (see .animate-marquee-header in globals.css).
export default function LivePriceScroller() {
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
    <div
      className="relative hidden h-9 flex-1 overflow-hidden rounded-full border md:block"
      style={{
        borderColor: "var(--posh-border)",
        background: "rgba(var(--posh-wash-rgb),0.03)",
      }}
      aria-label="Live material prices"
    >
      <div className="flex h-full w-max items-center animate-marquee-header">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex h-full shrink-0 items-center" aria-hidden={dup === 1}>
            {items.map((item, index) => (
              <span
                key={`${dup}-${item.name}`}
                className="flex items-center gap-2 whitespace-nowrap px-4 text-xs"
              >
                <span className="font-medium" style={{ color: "var(--posh-fg-muted)" }}>
                  {item.name}
                </span>
                <span className="font-semibold" style={{ color: "var(--posh-olive)" }}>
                  ₹{item.price.toLocaleString("en-IN")}
                </span>
                {index < items.length - 1 ? (
                  <span aria-hidden style={{ color: "var(--posh-border)" }}>
                    ·
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
