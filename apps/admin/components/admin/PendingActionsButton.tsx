"use client";

// Replaces the previous hardcoded, non-interactive "7 items need action"
// badge in app/(admin)/layout.tsx. That span was always a static literal —
// never backed by real data and never clickable — so it displayed a fixed
// "7" regardless of how many items actually needed admin action (including
// zero). This component instead renders the REAL total
// (AdminDashboardService.getSummary()'s pendingActionsCount, computed from
// live PENDING/PENDING_REVIEW/open-status counts across every existing
// admin queue — vendors, KYC, disputes, payments, advance payments,
// supplier invoices), and clicking it opens a dropdown listing each
// category with its own count and a direct link to that queue's existing
// page — mirroring GlobalSearch.tsx's overlay-dropdown pattern already used
// elsewhere in this same header.
import { useState } from "react";
import Link from "next/link";

export type PendingActionItem = {
  key: string;
  label: string;
  count: number;
  href: string;
};

type PendingActionsButtonProps = {
  totalCount: number;
  items: PendingActionItem[];
};

export function PendingActionsButton({ totalCount, items }: PendingActionsButtonProps) {
  const [open, setOpen] = useState(false);
  const actionable = items.filter((item) => item.count > 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={totalCount === 0}
        className={`rounded-full px-3 py-1 text-xs font-bold transition ${
          totalCount > 0
            ? "bg-red-50 text-red-700 hover:bg-red-100"
            : "cursor-default bg-emerald-50 text-emerald-700"
        }`}
      >
        {totalCount > 0 ? `${totalCount} item${totalCount === 1 ? "" : "s"} need action` : "All caught up"}
      </button>

      {open && totalCount > 0 ? (
        <>
          <button
            type="button"
            aria-label="Close pending actions"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            tabIndex={-1}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-lg"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-900">Pending Actions</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {actionable.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-slate-50"
                  >
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                      {item.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
