"use client";

import { useEffect, useState } from "react";
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

function confidenceBadgeClass(confidence: string | null) {
  if (confidence === "HIGH") return "bg-green-50 text-green-700 border-green-200";
  if (confidence === "MEDIUM") return "bg-amber-50 text-amber-700 border-amber-200";
  if (confidence === "LOW") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Watchlist</h1>
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <Bell size={12} /> WhatsApp alerts enabled
        </span>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
        <TrendingDown className="text-blue-500 shrink-0 mt-0.5" size={18} />
        <div>
          <p className="text-sm font-medium text-blue-800">How price alerts work</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Set a target price on any material. Once a verified market price for your area reaches your target, we
            send a WhatsApp alert. We only alert on confident, verified prices — never estimates or low-confidence
            data. (FR-07, FR-31)
          </p>
        </div>
      </div>

      {/* Watchlist items */}
      {items.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-slate-400 text-sm">No items in watchlist.</p>
          <Link href="/products" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Browse and watchlist materials →
          </Link>
        </div>
      ) : (
        <div className="panel divide-y divide-slate-100">
          {items.map((item) => {
            const pi = item.priceIntelligence;
            return (
              <div key={item.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Listing price: INR {item.basePrice.toLocaleString("en-IN")} / {item.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-slate-600">
                      Target: {item.targetPrice ? `INR ${item.targetPrice.toLocaleString("en-IN")}` : "Not set"}
                    </p>
                    <button
                      disabled={loadingId === item.id}
                      onClick={() => void handleRemove(item.productId, item.id)}
                      className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40"
                      aria-label={`Remove ${item.name} from watchlist`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Price Intelligence panel */}
                {pi?.resolved ? (
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                    <span className="font-medium text-slate-700">
                      Market price: INR {pi.currentPricePerBaseUnit?.toLocaleString("en-IN")} / {pi.baseUnit}
                    </span>
                    {pi.confidence && (
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${confidenceBadgeClass(
                          pi.confidence
                        )}`}
                      >
                        {pi.confidence} confidence
                      </span>
                    )}
                    {pi.methodLabel && (
                      <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-[11px] text-slate-600">
                        {pi.methodLabel}
                      </span>
                    )}
                    {pi.districtName && <span className="text-slate-400">{pi.districtName}</span>}
                    {pi.isStale && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <Clock size={11} /> Stale
                      </span>
                    )}
                    {typeof pi.gapToTarget === "number" && item.targetPrice && (
                      <span className={pi.gapToTarget <= 0 ? "text-green-600 font-medium" : "text-slate-500"}>
                        {pi.gapToTarget <= 0
                          ? "Target reached"
                          : `INR ${pi.gapToTarget.toLocaleString("en-IN")} above target`}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex items-center gap-2 text-xs text-slate-400">
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
                  <div className="text-[11px] text-slate-400 space-y-0.5">
                    {item.recentEvaluations.slice(0, 3).map((ev, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span>{new Date(ev.evaluatedAt).toLocaleDateString("en-IN")}:</span>
                        <span className={ev.didTrigger ? "text-green-600" : "text-slate-400"}>
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
