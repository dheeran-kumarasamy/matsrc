"use client";

import Link from "next/link";
import { useState } from "react";

export function SupplierFabMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-30">
      {open ? (
        <div className="mb-3 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <Link href="/listings/new" className="block border-b border-slate-200 bg-teal-50 px-4 py-3 text-lg text-slate-800 hover:bg-teal-100">
            Add New Listing
          </Link>
          <Link href="/rfqs" className="block border-b border-slate-200 px-4 py-3 text-lg text-slate-800 hover:bg-slate-50">
            Browse Enquiries
          </Link>
          <Link href="/onboarding" className="block px-4 py-3 text-lg text-slate-800 hover:bg-slate-50">
            Continue Setup
          </Link>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="grid h-16 w-16 place-items-center rounded-full bg-teal-600 text-white shadow-lg transition hover:bg-teal-700"
        aria-label="Open quick actions"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
