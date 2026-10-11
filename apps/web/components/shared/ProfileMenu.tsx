"use client";

// Single shared profile control for the top navigation — avatar (dynamic
// two-letter initials) + first-name-only text, with a dropdown for
// "View profile" / "Sign out". Used by every page's header via
// components/shared/AppHeader.tsx (builder portal, /newdashboard, and any
// future surface) so the exact same authenticated session always renders
// the exact same name/initials everywhere — no per-page hardcoded profile
// display.
//
// Session data comes from the existing NextAuth session (next-auth/react's
// useSession()) — same auth mechanism already used app-wide. Name/initials
// derivation is centralized in lib/user-display.ts so this component stays
// purely presentational.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { LogIn, LogOut, User } from "lucide-react";
import { getFirstName, getInitials } from "@/lib/user-display";
import { builderApiGet } from "@/lib/api";

// Net account balance indicator — reuses the EXACT SAME authoritative
// source as the Advance Balance page (app/(builder)/advance/page.tsx):
// GET /api/builder/advance, backed by CustomerAdvanceAccount.availableBalance
// (see packages/db/lib/advance-ledger.ts). That field is already the
// buyer's net spendable position — ledger CREDITs minus whatever has been
// consumed (ORDER_PAYMENT) or is currently reserved against an order
// (ADVANCE_RESERVATION), plus any REFUND/REVERSAL/ADJUSTMENT — never a
// raw "total advance paid" or "total outstanding orders" figure. No new
// balance calculation is introduced here; this component only renders
// what the existing endpoint returns.
type AdvanceBalanceSummary = {
  availableBalance: number;
  pendingAdvance: number;
  currency: string;
  status: string;
};

const BALANCE_POLL_INTERVAL_MS = 30_000;

function formatInr(amount: number): string {
  // Matches the existing Indian-currency convention used by the Advance
  // Balance page and /newdashboard (₹ prefix + "en-IN" grouping).
  const sign = amount < 0 ? "-" : "";
  return `${sign}₹${Math.abs(amount).toLocaleString("en-IN")}`;
}

function useNetBalance(enabled: boolean) {
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    function load() {
      builderApiGet<AdvanceBalanceSummary>("/advance")
        .then((data) => {
          if (!active) return;
          setBalance(Number(data.availableBalance));
          setStatus("ready");
        })
        .catch(() => {
          if (!active) return;
          setStatus("error");
        });
    }

    load();
    const interval = setInterval(load, BALANCE_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [enabled]);

  return { balance, status };
}

export default function ProfileMenu() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Hook must run unconditionally (before the early returns below), so it
  // only actually fetches once the buyer is confirmed authenticated —
  // never for a logged-out visitor or another user's session.
  const { balance, status: balanceStatus } = useNetBalance(status === "authenticated");

  if (status === "loading") {
    return (
      <div className="h-8 w-8 animate-pulse rounded-full border border-slate-200 bg-slate-100" />
    );
  }

  if (status !== "authenticated" || !session?.user) {
    return (
      <button
        onClick={() => router.push("/auth/login")}
        aria-label="Sign in"
        className="flex items-center gap-2 rounded-full border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] px-3 py-1.5 text-sm font-bold text-[color:var(--posh-fg)] transition hover:border-[color:var(--posh-primary)]"
      >
        <LogIn size={16} />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }

  const name = session.user.name;
  const email = session.user.email;
  // Only the first name is shown as text (e.g. "Dheeran Kumarasamy" ->
  // "Dheeran"); the avatar carries the two-letter initials ("DK"). Both are
  // derived dynamically from the authenticated profile — never hardcoded.
  const firstName = getFirstName(name, email, "Profile");
  const initials = getInitials(name, email, "U");
  const fullLabel = name || email || "Account";

  // Net account balance badge content — compact text only; loading/error/
  // missing-data states render nothing rather than a misleading ₹0, since
  // this is purely an informational indicator and must never imply a
  // balance that hasn't actually been confirmed yet (per spec: "Handle
  // loading, missing data, zero balance, negative balance, and API errors
  // gracefully"). Zero and negative balances ARE shown, formatted the same
  // way as everywhere else (see formatInr above).
  const balanceLabel = balanceStatus === "ready" && balance !== null ? formatInr(balance) : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Logged in as ${fullLabel}`}
        className="relative flex items-center gap-2 rounded-full border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] px-2.5 py-1.5 text-sm font-bold text-[color:var(--posh-fg)] transition hover:border-[color:var(--posh-primary)]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--posh-primary)] text-xs font-bold text-[color:var(--posh-primary-fg)]">
          {initials}
        </span>
        <span className="hidden max-w-[8rem] truncate sm:inline">{firstName}</span>
        {balanceLabel ? (
          // Small superscript-style badge, positioned at the top-right
          // corner of the profile control without growing the header's
          // height. Sourced from GET /api/builder/advance's
          // `availableBalance` (see useNetBalance above) — the same
          // authoritative, ledger-backed net balance shown on the Advance
          // Balance page, never an independently computed figure.
          <span
            title="Net account balance"
            aria-label={`Net account balance: ${balanceLabel}`}
            className="absolute -right-1.5 -top-1.5 whitespace-nowrap rounded-full border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-[color:var(--posh-fg)] shadow-sm"
          >
            {balanceLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-3 shadow-lg"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <User size={16} className="text-slate-400" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">{fullLabel}</p>
                {email ? <p className="truncate text-[11px] text-slate-400">{email}</p> : null}
              </div>
            </div>
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <User size={14} />
              View profile
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                void signOut({ callbackUrl: "/auth/login" });
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-bold text-[color:var(--posh-fg)] transition hover:bg-[rgba(var(--posh-wash-rgb),0.05)]"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
