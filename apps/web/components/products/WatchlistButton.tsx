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
        className={`flex w-full items-center justify-center gap-2 rounded-full border-2 py-2.5 text-xs font-bold uppercase tracking-[0.14em] transition-all disabled:opacity-50 ${watching ? "posh-btn-solid" : "border-[color:var(--posh-border)] text-[color:var(--posh-fg-muted)] hover:border-[color:var(--posh-olive)] hover:text-[color:var(--posh-olive)]"}`}
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
            className="flex-1 rounded-xl border border-[color:var(--posh-border)] px-3 py-2 text-xs font-medium text-[color:var(--posh-fg)] focus:border-[color:var(--posh-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--posh-primary)]"
          />
          <button onClick={saveWatchlist} disabled={saving} className="posh-btn-solid rounded-full px-4 text-xs font-bold uppercase tracking-[0.14em] disabled:opacity-50">{saving ? "..." : "Save"}</button>
        </div>
      )}
      {error && <p className="mt-1 text-xs font-bold text-[color:var(--posh-fg)]">{error}</p>}
    </div>
  );
}
