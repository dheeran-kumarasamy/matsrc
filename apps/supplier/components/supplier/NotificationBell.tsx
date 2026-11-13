"use client";

// Bell icon + overlay dropdown for supplier-facing alerts — the Supplier
// Portal equivalent of apps/web's components/builder/NotificationBell.tsx
// (same polling/read-tracking/deep-link behaviour, restyled to this portal's
// existing teal/slate palette since apps/web's `--posh-*` CSS variables are
// not defined here — see apps/supplier/app/globals.css).
//
// Backed by the existing Notification table — every supplier-facing event
// (new RFQ/enquiry received, candidate-promotion reassignment, Purchase
// Order generated, etc — see apps/web/lib/notify.ts and
// apps/supplier/lib/supplier-data.ts's notifySupplierOrderSubmittedForCandidate)
// already writes a row here with `audience: "supplier"`; this is simply the
// first in-app surface that reads them back, via
// /api/supplier/notifications (see that route's own doc comment). Polls
// periodically so the unread badge stays fresh without a full websocket
// setup, mirroring the builder portal's identical approach.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  // Present for order-related alerts (new RFQ, PO generated, reassignment)
  // — lets clicking the alert deep-link straight into that order's detail
  // page.
  orderId?: string | null;
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

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(() => {
    fetch("/api/supplier/notifications", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load notifications: ${res.status}`);
        return res.json() as Promise<NotificationsResponse>;
      })
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

  // Auto-hide on outside click/Escape — mirrors SupplierHeader.tsx's
  // existing profile-dropdown pattern exactly, scoped to this component.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      try {
        await fetch(`/api/supplier/notifications/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: true }),
        });
      } catch {
        // Best-effort; a subsequent poll will reconcile state if this fails.
      }
    }

    if (item.orderId) {
      setOpen(false);
      router.push(`/orders/${item.orderId}`);
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/supplier/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      // Best-effort; a subsequent poll will reconcile state if this fails.
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Alerts"
        aria-expanded={open}
        className="relative flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:border-teal-500"
      >
        <Bell size={16} />
        <span className="hidden sm:inline">Alerts</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1 text-[11px] font-bold text-white">
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
                  className="text-xs font-bold text-teal-700 hover:underline"
                >
                  Mark all as read
                </button>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-6 text-center text-xs text-slate-400">Loading alerts…</p>
              ) : error ? (
                <p className="px-4 py-6 text-center text-xs font-bold text-red-600">Could not load alerts.</p>
              ) : items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-slate-500">You&apos;re all caught up.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    New RFQs, Purchase Orders, and account updates will appear here.
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
                          !item.read ? "bg-teal-50/60" : ""
                        }`}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                            item.read ? "bg-transparent" : "bg-teal-600"
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
