"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Bell, TrendingDown, Trash2, AlertCircle, Clock } from "lucide-react";
import { builderApiDelete, builderApiGet } from "@/lib/api";

type PriceIntelligence = {
  resolved: boolean;
  emptyReason: "NO_SKU_MATCH" | "NO_DISTRICT" | "NO_DISTRICT_DATA" | null;
  districtName: string | null;
  priceDate: string | null;
  currentPricePerBaseUnit: number | null;
  baseUnit: string | null;
  confidence: string | null;
  method: string | null;
  methodLabel: string | null;
  publicDisplayAllowed: boolean | null;
  isStale: boolean | null;
  gapToTarget: number | null;
  gapToTargetPct: number | null;
} | null;

type RecentEvaluation = {
  evaluatedAt: string;
  didTrigger: boolean;
  suppressedReason: string | null;
  suppressedReasonLabel: string | null;
};

type WatchlistItem = {
  id: string;
  productId: string;
  name: string;
  unit: string;
  basePrice: number;
  targetPrice: number | null;
  alertSent: boolean;
  priceIntelligence: PriceIntelligence;
  recentEvaluations: RecentEvaluation[];
};

// Confidence is expressed in monochrome: HIGH is solid black, MEDIUM an
// outlined chip, LOW a faded chip. No colour is used anywhere in the portal.
function confidenceBadgeStyle(confidence: string | null): CSSProperties {
  if (confidence === "HIGH") {
    return { background: "var(--posh-primary)", color: "var(--posh-primary-fg)", borderColor: "var(--posh-primary)" };
  }
  if (confidence === "MEDIUM") {
    return { background: "var(--posh-bg-card)", color: "var(--posh-fg)", borderColor: "var(--posh-border)" };
  }
  if (confidence === "LOW") {
    return { background: "var(--posh-bg-card)", color: "var(--posh-fg-muted)", borderColor: "var(--posh-border)" };
  }
  return { background: "var(--posh-bg-card)", color: "var(--posh-fg-muted)", borderColor: "var(--posh-border)" };
}

// UF-09: Watchlist & Price Alerts — FR-07, FR-31
export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadWatchlist() {
      try {
        const payload = await builderApiGet<WatchlistItem[]>("/watchlist");
        if (!active) return;
        setItems(payload);
      } catch {
        if (!active) return;
        setItems([]);
      }
    }

    void loadWatchlist();
    return () => {
      active = false;
    };
  }, []);

  async function handleRemove(productId: string, id: string) {
    setLoadingId(id);
    try {
      await builderApiDelete(`/watchlist/${productId}`);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="posh-body space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="posh-eyebrow">Price desk</p>
          <h1 className="posh-page-title mt-2">Watchlist</h1>
          <p className="posh-subtitle mt-2 max-w-2xl">
            Track the materials you buy most and get told the moment they hit your target price.
          </p>
        </div>
        <span className="posh-label flex items-center gap-1.5">
          <Bell size={12} /> WhatsApp alerts enabled
        </span>
      </header>

      <div className="posh-card flex gap-3 p-5">
        <TrendingDown className="mt-0.5 shrink-0" style={{ color: "var(--posh-primary)" }} size={18} />
        <div>
          <p className="posh-card-title text-base">How price alerts work</p>
          <p className="mt-1 text-xs font-medium" style={{ color: "var(--posh-fg-muted)" }}>
            Set a target price on any material. Once a verified market price for your area reaches your target, we
            send a WhatsApp alert. We only alert on confident, verified prices — never estimates or low-confidence
            data. (FR-07, FR-31)
          </p>
        </div>
      </div>

      {/* Watchlist items */}
      {items.length === 0 ? (
        <div className="posh-card p-10 text-center">
          <p className="posh-card-title">No items in watchlist</p>
          <Link href="/products" className="posh-link mt-4 inline-block">
            Browse and watchlist materials →
          </Link>
        </div>
      ) : (
        <div className="posh-card divide-y divide-[color:var(--posh-border)]">
          {items.map((item) => {
            const pi = item.priceIntelligence;
            return (
              <div key={item.id} className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-base font-bold tracking-tight" style={{ color: "var(--posh-fg)" }}>{item.name}</p>
                    <p className="mt-1 text-xs font-semibold" style={{ color: "var(--posh-fg-muted)" }}>
                      Listing price: INR {item.basePrice.toLocaleString("en-IN")} / {item.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="posh-label">
                      Target: {item.targetPrice ? `INR ${item.targetPrice.toLocaleString("en-IN")}` : "Not set"}
                    </p>
                    <button
                      disabled={loadingId === item.id}
                      onClick={() => void handleRemove(item.productId, item.id)}
                      className="transition-colors disabled:opacity-40"
                      style={{ color: "var(--posh-fg-muted)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--posh-fg)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--posh-fg-muted)")}
                      aria-label={`Remove ${item.name} from watchlist`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Price Intelligence panel */}
                {pi?.resolved ? (
                  <div
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-3 text-xs"
                    style={{ borderColor: "var(--posh-border)", background: "rgba(240,232,216,0.04)" }}
                  >
                    <span className="font-bold" style={{ color: "var(--posh-fg)" }}>
                      Market price: INR {pi.currentPricePerBaseUnit?.toLocaleString("en-IN")} / {pi.baseUnit}
                    </span>
                    {pi.confidence && (
                      <span
                        className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                        style={confidenceBadgeStyle(pi.confidence)}
                      >
                        {pi.confidence} confidence
                      </span>
                    )}
                    {pi.methodLabel && (
                      <span
                        className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                        style={{ borderColor: "var(--posh-border)", background: "var(--posh-bg-card)", color: "var(--posh-fg-muted)" }}
                      >
                        {pi.methodLabel}
                      </span>
                    )}
                    {pi.districtName && <span className="font-semibold" style={{ color: "var(--posh-fg-muted)" }}>{pi.districtName}</span>}
                    {pi.isStale && (
                      <span className="flex items-center gap-1 font-bold" style={{ color: "var(--posh-fg-muted)" }}>
                        <Clock size={11} /> Stale
                      </span>
                    )}
                    {typeof pi.gapToTarget === "number" && item.targetPrice && (
                      <span
                        className="font-bold"
                        style={{ color: pi.gapToTarget <= 0 ? "var(--posh-primary)" : "var(--posh-fg-muted)" }}
                      >
                        {pi.gapToTarget <= 0
                          ? "Target reached"
                          : `INR ${pi.gapToTarget.toLocaleString("en-IN")} above target`}
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 rounded-xl border p-3 text-xs font-medium"
                    style={{ borderColor: "var(--posh-border)", background: "rgba(240,232,216,0.04)", color: "var(--posh-fg-muted)" }}
                  >
                    <AlertCircle size={12} />
                    {pi?.emptyReason === "NO_DISTRICT"
                      ? "Add a site with a city to get market price alerts for your area."
                      : pi?.emptyReason === "NO_DISTRICT_DATA"
                      ? "No verified market price is available for this material in your area yet."
                      : "Market price intelligence isn't available for this material yet."}
                  </div>
                )}

                {/* Alert history */}
                {item.recentEvaluations.length > 0 && (
                  <div className="space-y-0.5 text-[11px] font-medium" style={{ color: "var(--posh-fg-muted)" }}>
                    {item.recentEvaluations.slice(0, 3).map((ev, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span>{new Date(ev.evaluatedAt).toLocaleDateString("en-IN")}:</span>
                        <span style={{ color: ev.didTrigger ? "var(--posh-fg)" : "var(--posh-fg-muted)", fontWeight: ev.didTrigger ? 700 : 500 }}>
                          {ev.didTrigger ? "Alert sent" : ev.suppressedReasonLabel ?? "No alert"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
