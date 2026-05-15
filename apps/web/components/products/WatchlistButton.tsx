"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { builderApiPost, builderApiDelete } from "@/lib/api";

// FR-07: Watchlist a material with target price
export default function WatchlistButton({ productId, initialWatching = false }: { productId: string; initialWatching?: boolean }) {
  const [watching, setWatching] = useState(initialWatching);
  const [showTarget, setShowTarget] = useState(false);
  const [targetPrice, setTargetPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleWatchlist() {
    if (watching) {
      setSaving(true);
      try {
        await builderApiDelete(`/watchlist/${productId}`);
        setWatching(false);
      } catch {
        setError("Failed to remove");
      } finally {
        setSaving(false);
      }
      return;
    }
    setShowTarget(true);
  }

  async function saveWatchlist() {
    setSaving(true);
    setError("");
    try {
      await builderApiPost("/watchlist", {
        productId,
        targetPrice: targetPrice ? targetPrice : undefined,
      });
      setWatching(true);
      setShowTarget(false);
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleWatchlist}
        disabled={saving}
        className={`w-full flex items-center justify-center gap-2 border-2 rounded-lg py-2.5 text-sm font-medium transition-all disabled:opacity-50 ${watching ? "border-green-500 text-green-600 bg-green-50" : "border-slate-200 text-slate-600 hover:border-blue-700 hover:text-blue-700"}`}
      >
        {watching ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
        {watching ? "Watching — Price Alert Set" : "Add to Watchlist"}
      </button>

      {showTarget && !watching && (
        <div className="mt-2 flex gap-2">
          <input
            type="number"
            placeholder="Alert me below ₹..."
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
          <button onClick={saveWatchlist} disabled={saving} className="bg-blue-700 text-white rounded-lg px-3 text-xs font-medium disabled:opacity-50">{saving ? "..." : "Save"}</button>
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
