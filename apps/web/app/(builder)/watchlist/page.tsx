"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, TrendingDown, Trash2 } from "lucide-react";
import { builderApiDelete, builderApiGet } from "@/lib/api";

type WatchlistItem = {
  id: string;
  productId: string;
  name: string;
  unit: string;
  basePrice: number;
  targetPrice: number | null;
};

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
            Set a target price on any material. When the price drops below it, we send a WhatsApp alert instantly. Reply to the message to reorder in one step. (FR-07, FR-31)
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
          {items.map((item) => (
            <div key={item.id} className="p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Current: INR {item.basePrice.toLocaleString("en-IN")} / {item.unit}
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
          ))}
        </div>
      )}
    </div>
  );
}
