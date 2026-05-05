"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";

// FR-07: Watchlist a material with target price
export default function WatchlistButton({ productId }: { productId: string }) {
  const [watching, setWatching] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [targetPrice, setTargetPrice] = useState("");

  async function handleWatchlist() {
    if (watching) {
      setWatching(false);
      return;
    }
    setShowTarget(true);
  }

  async function saveWatchlist() {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, targetPrice: Number(targetPrice) }),
    });
    setWatching(true);
    setShowTarget(false);
  }

  return (
    <div>
      <button
        onClick={handleWatchlist}
        className={`w-full flex items-center justify-center gap-2 border-2 rounded-lg py-2.5 text-sm font-medium transition-all ${watching ? "border-green-500 text-green-600 bg-green-50" : "border-slate-200 text-slate-600 hover:border-blue-700 hover:text-blue-700"}`}
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
          <button onClick={saveWatchlist} className="bg-blue-700 text-white rounded-lg px-3 text-xs font-medium">Save</button>
        </div>
      )}
    </div>
  );
}
