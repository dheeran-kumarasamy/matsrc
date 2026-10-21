"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";


type SupplierHeaderProps = {
  kycStatus: "PENDING" | "APPROVED" | "REJECTED";
  // Profile name requirement: the supplier's registered company name
  // (falling back to the account-holder's name, then email — see
  // app/(supplier)/layout.tsx's resolution) shown alongside the profile
  // icon in the header, and never just the bare icon by itself.
  displayName: string;
};

const statusTone: Record<SupplierHeaderProps["kycStatus"], string> = {
  PENDING: "text-amber-600",
  APPROVED: "text-emerald-700",
  REJECTED: "text-red-600",
};

export function SupplierHeader({ kycStatus, displayName }: SupplierHeaderProps) {
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
    // Overlap fix: `backdrop-blur` (CSS backdrop-filter) creates its OWN
    // stacking context for this <header>, which traps the profile
    // dropdown's z-50 *inside* that context — from the page's root
    // stacking context, the whole header (dropdown included) is then just
    // one layer at the implicit z-index:auto level, ordered purely by DOM
    // position. components/supplier/MarketScroller.tsx's "LIVE" label sits
    // directly in the root stacking context at z-20 (its own wrapper has
    // no z-index, so it never traps its children into a sub-context), so
    // it was painting OVER the entire header, dropdown included, despite
    // the dropdown's own z-50 — z-50 only ever competed against the
    // scroller's layers from INSIDE the header's trapped context, never at
    // the root. Making the header itself `relative z-50` promotes the
    // header's entire stacking context above the scroller's z-20/z-10
    // layers at the root level, which is what actually fixes the overlap
    // (the dropdown's own z-50 is layered correctly once this encloses it).
    <header className="relative z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
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
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-slate-100"
            aria-expanded={open}
            aria-label="Open supplier menu"
          >
            {/* Profile name requirement: shown alongside the icon, never the
                bare icon alone. Truncated on narrow viewports so a long
                company name never pushes the icon off-screen. */}
            <span className="hidden max-w-[160px] truncate text-sm font-semibold text-slate-700 sm:block">
              {displayName}
            </span>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-teal-500 bg-slate-200 text-slate-600">
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
            // S17 / profile-dropdown overlap fix: this dropdown's own z-50
            // (vs. MarketScroller's z-10/z-20 layers) is only effective
            // because the enclosing <header> above is now itself
            // `relative z-50` — see that element's own doc comment for the
            // full stacking-context explanation (backdrop-blur traps a
            // child's z-index inside its own context otherwise).
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
