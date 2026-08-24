"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, LogIn } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useWatchlist } from "@/lib/watchlist-store";

// FR-07: Watchlist a material with target price
//
// Reads/writes through the single shared watchlist source of truth
// (lib/watchlist-store.tsx) instead of local component state, so this same
// product shows as "Watchlisted" everywhere — PDP, quick-view overlay, and
// the ProductCard toggle on the PLP — without a page refresh, and the state
// still comes from the persisted backend after one.
export default function WatchlistButton({ productId, initialWatching = false }: { productId: string; initialWatching?: boolean }) {
  const router = useRouter();
  const { status, isAuthenticated, isWatched, isPending, add, remove } = useWatchlist();
  const watching = status === "ready" ? isWatched(productId) : initialWatching;
  const saving = isPending(productId);

  const [showTarget, setShowTarget] = useState(false);
  const [targetPrice, setTargetPrice] = useState("");
  const [error, setError] = useState("");

  async function handleWatchlist() {
    setError("");

    if (!isAuthenticated) {
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    if (watching) {
      try {
        await remove(productId);
      } catch {
        setError("Failed to remove");
      }
      return;
    }
    setShowTarget(true);
  }

  async function saveWatchlist() {
    setError("");
    try {
      await add(productId, targetPrice || undefined);
      setShowTarget(false);
      setTargetPrice("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setError("Failed to save");
    }
  }

  return (
    <div>
      <button
        onClick={handleWatchlist}
        disabled={saving || status === "loading"}
        className={`flex w-full items-center justify-center gap-2 rounded-full border-2 py-2.5 text-xs font-bold uppercase tracking-[0.14em] transition-all disabled:opacity-50 ${watching ? "posh-btn-solid" : "border-[color:var(--posh-border)] text-[color:var(--posh-fg-muted)] hover:border-[color:var(--posh-olive)] hover:text-[color:var(--posh-olive)]"}`}
      >
        {!isAuthenticated ? <LogIn size={16} /> : watching ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
        {!isAuthenticated
          ? "Sign in to Watchlist"
          : watching
            ? "Watching — Price Alert Set"
            : "Add to Watchlist"}
      </button>

      {showTarget && !watching && isAuthenticated && (
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

