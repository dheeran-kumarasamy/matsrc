"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { LogIn, LogOut, User } from "lucide-react";


// Top-right header indicator showing whether the current session is logged
// in, and as whom. Click reveals a small dropdown with a sign-out action.
// When unauthenticated, it's a plain "Sign in" pill instead.
export default function UserSessionBadge() {
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

  const label = session.user.name || session.user.email || "Account";
  const initial = label.trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Logged in as ${label}`}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] px-2.5 py-1.5 text-sm font-bold text-[color:var(--posh-fg)] transition hover:border-[color:var(--posh-primary)]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--posh-primary)] text-xs font-bold text-[color:var(--posh-primary-fg)]">
          {initial}
        </span>
        <span className="hidden max-w-[8rem] truncate sm:inline">{label}</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-3 shadow-lg">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <User size={16} className="text-slate-400" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">{label}</p>
                {session.user.email ? (
                  <p className="truncate text-[11px] text-slate-400">{session.user.email}</p>
                ) : null}
              </div>
            </div>
            {/* BUG-08: "View Profile" entry point reachable in a single
                click from anywhere in the builder portal via this header
                dropdown, linking to the existing profile page. */}
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <User size={14} />
              View Profile
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
