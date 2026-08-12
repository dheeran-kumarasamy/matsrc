"use client";

// Responsive marketing site header — Posh editorial design.
// Fixed frosted-glass navbar: wordmark (left) + nav links + pill CTA (right).
// Below `md`: burger button opens a Sheet drawer with the same links.
// Preserves all existing auth/session logic unchanged.

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { useSession } from "next-auth/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";

const NAV_LINKS = [{ href: "/products", label: "Browse Materials" }];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  // BUG-07 fix: this header previously always rendered the guest
  // "Login / Register" CTA regardless of session state, even for an
  // already-authenticated builder. Now it checks `useSession()` and shows
  // "Go to Dashboard" when authenticated, a skeleton while loading, and the
  // guest CTA only when confirmed unauthenticated.
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const isLoading = status === "loading";

  return (
    <header className="posh-nav fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-10">

        {/* Wordmark */}
        <Link
          href="/"
          className="posh-heading text-2xl tracking-tight"
          style={{ color: "var(--posh-fg)" }}
        >
          Buildohub
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm transition-colors"
              style={{ color: "var(--posh-fg-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--posh-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--posh-fg-muted)")}
            >
              {link.label}
            </Link>
          ))}

          {isLoading ? (
            <div
              className="h-9 w-32 animate-pulse rounded-full"
              style={{ background: "var(--posh-border)" }}
            />
          ) : isAuthenticated ? (
            <Link href="/dashboard" className="posh-btn-pill font-medium">
              Go to Dashboard
            </Link>
          ) : (
            <Link href="/auth/login" className="posh-btn-pill font-medium">
              Sign in
            </Link>
          )}
        </nav>

        {/* Mobile burger */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-full transition md:hidden"
          style={{ color: "var(--posh-fg)", background: "var(--posh-border)" }}
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Mobile drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="flex flex-col border-0 p-0"
          style={{ background: "var(--posh-bg-card)", color: "var(--posh-fg)" }}
        >
          <SheetHeader className="border-b px-6 py-5" style={{ borderColor: "var(--posh-border)" }}>
            <SheetTitle
              className="posh-heading text-xl text-left"
              style={{ color: "var(--posh-fg)" }}
            >
              Buildohub
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-2 p-6">
            {NAV_LINKS.map((link) => (
              <SheetClose asChild key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-[48px] items-center rounded-2xl px-4 text-base transition"
                  style={{ color: "var(--posh-fg-muted)" }}
                >
                  {link.label}
                </Link>
              </SheetClose>
            ))}
            <div className="pt-4">
              {isLoading ? (
                <div className="h-12 animate-pulse rounded-full" style={{ background: "var(--posh-border)" }} />
              ) : isAuthenticated ? (
                <SheetClose asChild>
                  <Link
                    href="/dashboard"
                    className="flex min-h-[48px] items-center justify-center rounded-full text-base font-medium transition"
                    style={{ background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }}
                  >
                    Go to Dashboard
                  </Link>
                </SheetClose>
              ) : (
                <SheetClose asChild>
                  <Link
                    href="/auth/login"
                    className="flex min-h-[48px] items-center justify-center rounded-full text-base font-medium transition"
                    style={{ background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }}
                  >
                    Sign in
                  </Link>
                </SheetClose>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

