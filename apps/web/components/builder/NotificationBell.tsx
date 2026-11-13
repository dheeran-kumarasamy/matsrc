"use client";

// Bell icon + overlay dropdown for order-status alerts (REQ: "all order
// status changes should create a notification alert... alerts page should
// be an overlay dropdown from the bell icon rather than a separate page").
//
// Backed by the existing Notification table (apps/api's NotificationService
// already writes a row here for every order-decision, best-price-selection,
// and aggregation event) via /api/builder/notifications. Polls periodically
// so the unread badge stays fresh without a full websocket setup.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Bell } from "lucide-react";

import { builderApiGet, builderApiPatch } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  // Present for order-status alerts (accepted/declined/dispatched/
  // out-for-delivery/delivered/best-price-ready) — lets clicking the alert
  // deep-link straight into that order's detail overlay.
  orderId?: string | null;
};


type NotificationsResponse = {
  items: NotificationItem[];
  unreadCount: number;
};

type AccountNotificationState = {
  accountId: string | null;
  items: NotificationItem[];
  unreadCount: number;
};

type AccountErrorState = {
  accountId: string | null;
  hasError: boolean;
};

const POLL_INTERVAL_MS = 30_000;

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-IN");
}

export default function NotificationBell() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [open, setOpen] = useState(false);

  // Atomic account-scoped notification data structure.
  // Associating items and unreadCount with the owning account ID guarantees that
  // on logout or account switch, the previous account's notifications are immediately
  // hidden during the first render, without waiting for passive cleanup effects.
  const [accountData, setAccountData] = useState<AccountNotificationState>({
    accountId: null,
    items: [],
    unreadCount: 0,
  });

  const [loading, setLoading] = useState(false);

  const [accountError, setAccountError] = useState<AccountErrorState>({
    accountId: null,
    hasError: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);

  // Reliable account identifier:
  // sessionStatus === "authenticated" and session.user must both be present.
  const isAuthenticated = sessionStatus === "authenticated" && Boolean(session?.user);
  const currentAccountId = isAuthenticated
    ? (session?.user?.id || session?.user?.email || null)
    : null;

  // Account-scoped ownership check:
  // Derived state ensures that if currentAccountId is null (logout) or differs from
  // accountData.accountId (account switch), rendered items and unread count are immediately
  // empty during the first render before any passive effect runs.
  const isOwnedByCurrentAccount = Boolean(
    currentAccountId && accountData.accountId === currentAccountId
  );
  const items = isOwnedByCurrentAccount ? accountData.items : [];
  const unreadCount = isOwnedByCurrentAccount ? accountData.unreadCount : 0;

  // Account-scoped error check:
  // An error is only displayed if it belongs to the currently authenticated account.
  // When switching accounts or logging out, any previous account error is immediately
  // hidden on the first render before passive effects execute, preventing it from
  // leaking to the new account or suppressing its initial loading indicator.
  const isErrorOwnedByCurrentAccount = Boolean(
    currentAccountId && accountError.accountId === currentAccountId && accountError.hasError
  );
  const error = isErrorOwnedByCurrentAccount;

  // Initial account loading indicator:
  // Show loading if authenticated, but no response has yet arrived for this account and no error occurred.
  // Ordinary 30-second background polling retains existing notifications without flashing loading.
  const isInitialAccountLoading = Boolean(
    currentAccountId && accountData.accountId !== currentAccountId && !error
  );
  const showLoading = loading || isInitialAccountLoading;

  const currentAccountIdRef = useRef<string | null>(currentAccountId);
  currentAccountIdRef.current = currentAccountId;

  const prevAccountIdRef = useRef<string | null>(currentAccountId);
  const requestIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchNotifications = useCallback(async () => {
    const requestUser = currentAccountIdRef.current;
    const requestId = ++requestIdRef.current;

    // Do not initiate or process requests if not authenticated
    if (!requestUser) return;

    try {
      const data = await builderApiGet<NotificationsResponse>("/notifications");
      if (!isMountedRef.current) return;

      // Stale-response guard:
      // If the authenticated user changed, or if user logged out,
      // or if a newer request was dispatched while this was in flight, discard the response.
      if (currentAccountIdRef.current !== requestUser || requestIdRef.current !== requestId) {
        return;
      }

      setAccountData({
        accountId: requestUser,
        items: data.items ?? [],
        unreadCount: data.unreadCount ?? 0,
      });
      setAccountError({
        accountId: requestUser,
        hasError: false,
      });
    } catch (err) {
      if (!isMountedRef.current) return;
      if (currentAccountIdRef.current !== requestUser || requestIdRef.current !== requestId) {
        return;
      }
      setAccountError({
        accountId: requestUser,
        hasError: true,
      });
      throw err;
    } finally {
      if (
        isMountedRef.current &&
        currentAccountIdRef.current === requestUser &&
        requestIdRef.current === requestId
      ) {
        setLoading(false);
      }
    }
  }, [currentAccountId]);

  const { refresh } = usePolling(fetchNotifications, {
    intervalMs: POLL_INTERVAL_MS,
    enabled: Boolean(currentAccountId),
  });

  // Handle session transitions (logout, login, account switch)
  useEffect(() => {
    if (prevAccountIdRef.current !== currentAccountId) {
      // Invalidate any in-flight requests from the previous account or session
      requestIdRef.current++;
      prevAccountIdRef.current = currentAccountId;

      // Immediately clear previous account's notification state on logout or account switch
      setAccountData({
        accountId: null,
        items: [],
        unreadCount: 0,
      });
      setAccountError({
        accountId: null,
        hasError: false,
      });
      setOpen(false);

      if (currentAccountId) {
        setLoading(true);
        void refresh();
      } else {
        setLoading(false);
      }
    }
  }, [currentAccountId, refresh]);

  // Refresh the moment the dropdown is opened, so it's never stale.
  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.read) {
      setAccountData((prev) => {
        if (!currentAccountId || prev.accountId !== currentAccountId) return prev;
        return {
          ...prev,
          items: prev.items.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
          unreadCount: Math.max(0, prev.unreadCount - 1),
        };
      });
      try {
        await builderApiPatch(`/notifications/${item.id}`, { read: true });
      } catch {
        // Best-effort; a subsequent poll will reconcile state if this fails.
      }
    }

    // Order-status alerts (accepted/declined/dispatched/out-for-delivery/
    // delivered/best-price-ready) carry an orderId — navigate straight to
    // that order's detail view (renders as an overlay via the @modal
    // intercepting route since we're already inside the builder layout).
    if (item.orderId) {
      setOpen(false);
      router.push(`/orders/${item.orderId}`);
    }
  };


  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    setAccountData((prev) => {
      if (!currentAccountId || prev.accountId !== currentAccountId) return prev;
      return {
        ...prev,
        items: prev.items.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      };
    });
    try {
      await builderApiPatch("/notifications", { all: true });
    } catch {
      // Best-effort; a subsequent poll will reconcile state if this fails.
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex items-center gap-2 rounded-full border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] px-3 py-1.5 text-sm font-bold text-[color:var(--posh-fg)] transition hover:border-[color:var(--posh-primary)]"
      >
        <Bell size={16} />
        <span className="hidden sm:inline">Alerts</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--posh-primary)] px-1 text-[11px] font-bold text-[color:var(--posh-primary-fg)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-[color:var(--posh-bg-card)] shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-900">Alerts</p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs font-bold text-[color:var(--posh-fg)] hover:underline"
                >
                  Mark all as read
                </button>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {showLoading ? (
                <p className="px-4 py-6 text-center text-xs text-slate-400">Loading alerts…</p>
              ) : error ? (
                <p className="px-4 py-6 text-center text-xs font-bold text-[color:var(--posh-fg)]">Could not load alerts.</p>
              ) : items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-slate-500">You&apos;re all caught up.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Order status updates will appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => handleItemClick(item)}
                        className={`flex w-full gap-2.5 px-4 py-3 text-left transition hover:bg-slate-50 ${
                          !item.read ? "bg-[rgba(var(--posh-wash-rgb),0.04)]" : ""
                        }`}
                      >
                        {/* Unread/read marker */}
                        <span
                          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                            item.read ? "bg-transparent" : "bg-[color:var(--posh-primary)]"
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm ${
                              item.read ? "font-medium text-slate-600" : "font-bold text-slate-900"
                            }`}
                          >
                            {item.title}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.body}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{timeAgo(item.createdAt)}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
