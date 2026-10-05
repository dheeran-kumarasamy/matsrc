"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";


type SupplierHeaderProps = {
  kycStatus: "PENDING" | "APPROVED" | "REJECTED";
};

const statusTone: Record<SupplierHeaderProps["kycStatus"], string> = {
  PENDING: "text-amber-600",
  APPROVED: "text-emerald-700",
  REJECTED: "text-red-600",
};

export function SupplierHeader({ kycStatus }: SupplierHeaderProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const statusLabel = useMemo(() => {
    if (kycStatus === "APPROVED") return "Approved";
    if (kycStatus === "REJECTED") return "Rejected";
    return "Pending";
  }, [kycStatus]);

  // S16: auto-hide the profile dropdown — closes on outside click, Escape,
  // and route change, so it never remains visually open after navigation or
  // an action. Mirrors the same pattern already used by the shared
  // apps/web ProfileMenu/NotificationBell components (mousedown outside
  // listener + Escape keydown), scoped to this component only.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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

  // S16: close on route change (e.g. clicking "Onboarding" navigates away —
  // the menu must not remain open on the new page).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-[1260px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-lg p-1 hover:bg-slate-100" aria-label="Go to dashboard">
          <span className="relative h-12 w-48 overflow-hidden rounded-md">
            <Image src="/icons/logo-full.png" alt="Buildohub" fill className="object-contain" priority />
          </span>
          <p className="text-xl leading-none text-slate-800 sm:text-2xl">Supplier Portal</p>
        </Link>



        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-2 rounded-full p-1 hover:bg-slate-100"
            aria-expanded={open}
            aria-label="Open supplier menu"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-teal-500 bg-slate-200 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4.5 20c1.6-3.2 4.1-4.8 7.5-4.8s5.9 1.6 7.5 4.8" />
              </svg>
            </span>
            <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-700" fill="currentColor" aria-hidden="true">
              <path d="m5.2 7.5 4.8 5 4.8-5" />
            </svg>
          </button>

          {open ? (
            // S17 root cause: neither the header nor
            // components/supplier/MarketScroller.tsx ("live rate band")
            // establish their own stacking context (no position/z-index on
            // their outer elements), so their absolutely-positioned
            // children (this dropdown at the old z-20, and the ticker's
            // "LIVE" label also at z-20) competed in the *same* root
            // stacking context. With equal z-index, later DOM order wins —
            // the ticker renders after the header, so its label painted
            // over the dropdown. Raising the dropdown to z-50 (still a
            // deliberate, documented value rather than an arbitrary
            // 999999) unambiguously places it above the ticker's z-10/z-20
            // layers and any other in-page content.
            <div className="absolute right-0 top-[62px] z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-200 bg-teal-50/80 px-4 py-3 text-lg leading-none text-slate-900">
                KYC Status <span className={statusTone[kycStatus]}>({statusLabel})</span>
              </div>
              <Link
                href="/onboarding"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-lg text-slate-800 hover:bg-slate-50"
              >
                Onboarding
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  signOut({ callbackUrl: "/sign-in" });
                }}
                className="block w-full border-t border-slate-200 px-4 py-3 text-left text-lg text-red-600 hover:bg-slate-50"
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
