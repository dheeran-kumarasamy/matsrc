"use client";

// Single client-side source of truth for "is this product on my watchlist?"
// across the whole builder portal (PLP cards, PDP, the quick-view overlay,
// and the standalone /watchlist page all read/write through this same
// context instead of each keeping their own local boolean).
//
// It is a thin cache in front of the EXISTING watchlist backend
// (/api/builder/watchlist, /api/builder/watchlist/[productId] — see
// app/api/builder/watchlist/*) and the existing NextAuth session
// (next-auth/react's useSession(), already hydrated app-wide by
// AuthProvider in app/layout.tsx). No new backend, no new auth mechanism,
// no duplicate Watchlist model — this only centralizes the client state.
//
// Product identity: the id used everywhere here is Product.id (the same id
// returned as `id` by apps/supplier's /api/public/listings and used as
// `product.id`/`product.slug` on the PLP/PDP/quick-view — see lib/listings.ts),
// which is also exactly the id the Watchlist table's productId column and
// the /api/builder/watchlist routes key on. Using this one id consistently
// is what keeps a product's watchlist state identical across every surface.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { ApiError, builderApiDelete, builderApiGet, builderApiPost } from "@/lib/api";

type WatchlistStatus = "idle" | "loading" | "ready" | "error";

type WatchlistContextValue = {
  /** Whether the initial watchlist fetch has completed (avoids a flash of "not watchlisted"). */
  status: WatchlistStatus;
  isAuthenticated: boolean;
  isWatched: (productId: string) => boolean;
  /** True while an add/remove request for this specific product is in flight. */
  isPending: (productId: string) => boolean;
  /** Adds with an optional target price (PDP flow). Throws ApiError(401) if signed out. */
  add: (productId: string, targetPrice?: string | number | null) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  /** Convenience add/remove flip with no target price (PLP quick toggle). */
  toggle: (productId: string) => Promise<void>;
};

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";

  const [status, setStatus] = useState<WatchlistStatus>("idle");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    if (sessionStatus === "loading") return;

    if (!isAuthenticated) {
      // Signed-out visitors have no persisted watchlist to show — never a
      // fake local "watchlisted" state that would vanish on refresh.
      setWatchedIds(new Set());
      setStatus("ready");
      return;
    }

    setStatus("loading");
    (async () => {
      try {
        const items = await builderApiGet<Array<{ productId: string }>>("/watchlist");
        if (!active) return;
        setWatchedIds(new Set(items.map((item) => item.productId)));
        setStatus("ready");
      } catch {
        if (!active) return;
        setStatus("error");
      }
    })();

    return () => {
      active = false;
    };
  }, [isAuthenticated, sessionStatus]);

  const setPending = useCallback((productId: string, pending: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }, []);

  const add = useCallback(
    async (productId: string, targetPrice?: string | number | null) => {
      if (!isAuthenticated) throw new ApiError("Not authenticated", 401);
      setPending(productId, true);
      try {
        await builderApiPost("/watchlist", {
          productId,
          targetPrice: targetPrice === null || targetPrice === undefined || targetPrice === "" ? undefined : targetPrice,
        });
        setWatchedIds((prev) => new Set(prev).add(productId));
      } finally {
        setPending(productId, false);
      }
    },
    [isAuthenticated, setPending]
  );

  const remove = useCallback(
    async (productId: string) => {
      if (!isAuthenticated) throw new ApiError("Not authenticated", 401);
      setPending(productId, true);
      try {
        await builderApiDelete(`/watchlist/${productId}`);
        setWatchedIds((prev) => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      } finally {
        setPending(productId, false);
      }
    },
    [isAuthenticated, setPending]
  );

  const toggle = useCallback(
    async (productId: string) => {
      if (watchedIds.has(productId)) {
        await remove(productId);
      } else {
        await add(productId);
      }
    },
    [watchedIds, add, remove]
  );

  const value = useMemo<WatchlistContextValue>(
    () => ({
      status,
      isAuthenticated,
      isWatched: (productId: string) => watchedIds.has(productId),
      isPending: (productId: string) => pendingIds.has(productId),
      add,
      remove,
      toggle,
    }),
    [status, isAuthenticated, watchedIds, pendingIds, add, remove, toggle]
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) {
    throw new Error("useWatchlist must be used within a WatchlistProvider");
  }
  return ctx;
}
