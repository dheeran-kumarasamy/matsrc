"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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

  const statusLabel = useMemo(() => {
    if (kycStatus === "APPROVED") return "Approved";
    if (kycStatus === "REJECTED") return "Rejected";
    return "Pending";
  }, [kycStatus]);

  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-[1260px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-lg p-1 hover:bg-slate-100" aria-label="Go to dashboard">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-blue-200 bg-gradient-to-b from-blue-100 to-blue-50 text-blue-700">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V20h14V9.5" />
              <path d="M9 20v-6h6v6" />
            </svg>
          </span>
          <p className="text-xl leading-none text-slate-800 sm:text-2xl">
            <span className="font-bold text-slate-900">BuildMart</span> Supplier Portal
          </p>
        </Link>

        <div className="relative">
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
            <div className="absolute right-0 top-[62px] z-20 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-200 bg-teal-50/80 px-4 py-3 text-lg leading-none text-slate-900">
                KYC Status <span className={statusTone[kycStatus]}>({statusLabel})</span>
              </div>
              <Link href="/onboarding" className="block px-4 py-3 text-lg text-slate-800 hover:bg-slate-50">
                Onboarding
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
