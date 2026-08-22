"use client";

// Responsive marketing site header — Posh editorial design.
// Fixed frosted-glass navbar: wordmark (left) + nav links + pill CTA (right).
// Below `md`: burger button opens a Sheet drawer with the same links.
// Preserves all existing auth/session logic unchanged.

import { useState } from "react";
import Link from "next/link";
import { Menu, Search, X } from "lucide-react";

import { useSession } from "next-auth/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import LivePriceScroller from "@/components/home/LivePriceScroller";
import BuildOHubLogo from "@/components/shared/BuildOHubLogo";

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
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-5 md:gap-8 md:px-10">

        {/* Wordmark — shared BuildOHubLogo component (see
            components/shared/BuildOHubLogo.tsx) so every surface renders an
            identical "BuildOHub" mark. */}
        <BuildOHubLogo />

        {/* Live Price Scroller — replaces the old header search bar and
            Browse Materials link in this position (see LivePriceScroller.tsx).
            The search bar and Browse Material action now live in the hero
            below instead, so they are not duplicated here. */}
        <LivePriceScroller />

        {/* Desktop nav — session-aware CTA only; Browse Materials moved
            into the hero (search row) so it isn't duplicated in the header. */}
        <nav className="ml-auto hidden items-center gap-6 md:flex">
          {isLoading ? (
            <div
              className="h-9 w-32 animate-pulse rounded-full"
              style={{ background: "var(--posh-border)" }}
            />
          ) : isAuthenticated ? (
            <Link href="/newdashboard" className="posh-btn-pill font-medium">
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

      {/* Mobile drawer — Radix renders this via a Portal to document.body,
          which sits OUTSIDE the theme-home-scoped <main> in app/page.tsx.
          Re-applying theme-home directly on the portalled content keeps the
          --posh-* variables resolving to Home's dark palette here too. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="theme-home flex flex-col border-0 p-0"
          style={{ background: "var(--posh-bg-card)", color: "var(--posh-fg)" }}
        >
          <SheetHeader className="border-b px-6 py-5" style={{ borderColor: "var(--posh-border)" }}>
            <SheetTitle className="text-left">
              <BuildOHubLogo href={null} />
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-2 p-6">
            {/* Mobile search — same /products?q= deep link as the desktop
                search bar above, surfaced inside the drawer since this
                header uses a Sheet-based mobile menu rather than an inline
                search row below the nav bar. */}
            <form
              action="/products"
              method="GET"
              role="search"
              className="relative mb-4"
            >
              <Search
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--posh-fg-muted)" }}
              />
              <input
                type="search"
                name="q"
                aria-label="Search materials, suppliers or grades"
                placeholder="Search materials or suppliers…"
                className="w-full rounded-full border py-2.5 pl-11 pr-4 text-sm outline-none transition-colors"
                style={{
                  borderColor: "var(--posh-border)",
                  background: "rgba(var(--posh-wash-rgb),0.06)",
                  color: "var(--posh-fg)",
                }}
              />
            </form>
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
                    href="/newdashboard"
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

