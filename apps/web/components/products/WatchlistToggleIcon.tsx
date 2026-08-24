"use client";

// Compact icon-only watchlist toggle for the PLP ProductCard (and any other
// dense-list surface). Reads/writes through the same shared source of truth
// as the full WatchlistButton (lib/watchlist-store.tsx) — same productId,
// same backend, same persisted state — so a card watchlisted here shows as
// watchlisted on the PDP too, and vice versa.
//
// Rendered *inside* a next/link card (see ProductCard.tsx), so clicks must
// stop propagation/prevent default to avoid also navigating to the PDP.

import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useWatchlist } from "@/lib/watchlist-store";

export default function WatchlistToggleIcon({ productId }: { productId: string }) {
  const router = useRouter();
  const { status, isAuthenticated, isWatched, isPending, toggle } = useWatchlist();
  const watching = status === "ready" && isWatched(productId);
  const pending = isPending(productId);

  async function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (!isAuthenticated) {
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    try {
      await toggle(productId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      }
      // Non-auth failures fail silently here (dense list context); the
      // full WatchlistButton on the PDP surfaces a text error if needed.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || status === "loading"}
      aria-pressed={watching}
      aria-label={watching ? "Remove from watchlist" : "Add to watchlist"}
      title={watching ? "Watchlisted" : "Add to watchlist"}
      className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors disabled:opacity-50"
      style={
        watching
          ? { background: "var(--posh-primary)", borderColor: "var(--posh-primary)", color: "var(--posh-primary-fg)" }
          : { background: "rgba(255,255,255,0.9)", borderColor: "var(--posh-border)", color: "var(--posh-fg-muted)" }
      }
    >
      {watching ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
    </button>
  );
}
