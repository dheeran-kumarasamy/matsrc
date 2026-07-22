"use client";

// Bell icon + overlay dropdown for order-status alerts (REQ: "all order
// status changes should create a notification alert... alerts page should
// be an overlay dropdown from the bell icon rather than a separate page").
//
// Backed by the existing Notification table (apps/api's NotificationService
// already writes a row here for every order-decision, best-price-selection,
// and aggregation event) via /api/builder/notifications. Polls periodically
// so the unread badge stays fresh without a full websocket setup.

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { builderApiGet, builderApiPatch } from "@/lib/api";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

type NotificationsResponse = {
  items: NotificationItem[];
  unreadCount: number;
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
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(() => {
    builderApiGet<NotificationsResponse>("/notifications")
      .then((data) => {
        setItems(data.items ?? []);
        setUnreadCount(data.unreadCount ?? 0);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Refresh the moment the dropdown is opened, so it's never stale.
  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open, fetchNotifications]);

  const handleItemClick = async (item: NotificationItem) => {
    if (item.read) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await builderApiPatch(`/notifications/${item.id}`, { read: true });
    } catch {
      // Best-effort; a subsequent poll will reconcile state if this fails.
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
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
        className="relative flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-blue-700 hover:text-blue-700"
      >
        <Bell size={16} />
        <span className="hidden sm:inline">Alerts</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-900">Alerts</p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  Mark all as read
                </button>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-6 text-center text-xs text-slate-400">Loading alerts…</p>
              ) : error ? (
                <p className="px-4 py-6 text-center text-xs text-red-500">Could not load alerts.</p>
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
                          !item.read ? "bg-blue-50/60" : ""
                        }`}
                      >
                        {/* Unread/read marker */}
                        <span
                          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                            item.read ? "bg-transparent" : "bg-blue-700"
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
