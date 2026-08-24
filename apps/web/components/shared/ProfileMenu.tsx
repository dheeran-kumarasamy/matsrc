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

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { LogIn, LogOut, User } from "lucide-react";
import { getFirstName, getInitials } from "@/lib/user-display";

export default function ProfileMenu() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Logged in as ${fullLabel}`}
        className="flex items-center gap-2 rounded-full border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] px-2.5 py-1.5 text-sm font-bold text-[color:var(--posh-fg)] transition hover:border-[color:var(--posh-primary)]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--posh-primary)] text-xs font-bold text-[color:var(--posh-primary-fg)]">
          {initials}
        </span>
        <span className="hidden max-w-[8rem] truncate sm:inline">{firstName}</span>
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
