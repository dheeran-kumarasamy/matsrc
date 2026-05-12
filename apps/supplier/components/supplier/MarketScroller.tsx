"use client";

import { useEffect, useRef, useState } from "react";
import type { MarketScrollItem } from "@/lib/supplier-data";

const REFRESH_INTERVAL_MS = 30_000;

function TickerChip({ item }: { item: MarketScrollItem }) {
  const isMarket = item.type === "market";

  return (
    <div className="inline-flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white/90 px-5 py-3 shadow-sm">
      {/* Source badge */}
      <span
        className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${
          isMarket
            ? "bg-indigo-100 text-indigo-700"
            : "bg-teal-100 text-teal-700"
        }`}
      >
        {isMarket ? "MARKET" : "YOU"}
      </span>

      {/* Category */}
      <span className="text-sm font-semibold text-slate-700">{item.category}</span>

      <span className="text-slate-300">·</span>

      {/* Primary metric */}
      <span className="text-base font-extrabold text-slate-900">{item.primaryValue}</span>

      <span className="text-slate-300">·</span>

      {/* Sub detail */}
      <span className="text-sm text-slate-500">{item.subValue}</span>

      {/* Share pill */}
      {item.sharePercent !== null && (
        <>
          <span className="text-slate-300">·</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              item.sharePercent >= 50
                ? "bg-emerald-100 text-emerald-700"
                : item.sharePercent >= 20
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-600"
            }`}
          >
            {item.sharePercent}% share
          </span>
        </>
      )}
    </div>
  );
}

type Props = {
  initialItems: MarketScrollItem[];
};

export function MarketScroller({ initialItems }: Props) {
  const [items, setItems] = useState<MarketScrollItem[]>(initialItems);
  const trackRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);

  // Refresh data every 30 s
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/supplier/market-scroll", { cache: "no-store" });
        if (res.ok) {
          const fresh: MarketScrollItem[] = await res.json();
          if (fresh.length > 0) setItems(fresh);
        }
      } catch {
        // silently ignore network errors during refresh
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Continuous CSS scroll animation — restarts if items change
  useEffect(() => {
    const track = trackRef.current;
    if (!track || items.length === 0) return;

    // Cancel any running animation
    animRef.current?.cancel();

    const totalWidth = track.scrollWidth / 2; // because we duplicate items below
    const duration = totalWidth * 18; // ~18ms per px → smooth but not too fast

    animRef.current = track.animate(
      [{ transform: "translateX(0)" }, { transform: `translateX(-${totalWidth}px)` }],
      { duration, iterations: Infinity, easing: "linear" },
    );

    return () => {
      animRef.current?.cancel();
    };
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-sm text-slate-400">
        No market data yet — add listings to see category intelligence here.
      </div>
    );
  }

  // Duplicate items so the loop is seamless
  const doubled = [...items, ...items];

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 shadow-sm">
      {/* Left fade */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-gradient-to-r from-slate-50 to-transparent" />
      {/* Right fade */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-slate-50 to-transparent" />

      {/* Label */}
      <div className="absolute inset-y-0 left-0 z-20 flex items-center px-4">
        <span className="rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow">
          LIVE
        </span>
      </div>

      <div className="flex items-center py-4 pl-20 pr-4">
        <div ref={trackRef} className="flex gap-4 whitespace-nowrap will-change-transform">
          {doubled.map((item, i) => (
            <TickerChip key={`${item.type}-${item.category}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
