"use client";

// Responsive marketing site header. Desktop shows the full inline nav;
// below `md` the inline links are replaced by a burger button that opens a
// Sheet drawer with the same links stacked vertically. Sticky + translucent
// so it stays usable while scrolling without overlapping content.

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
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

  return (
    <nav className="sticky top-0 z-50 bg-brand-500/95 text-white shadow-md backdrop-blur supports-[backdrop-filter]:bg-brand-500/90">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Build<span className="text-accent-500">Mart</span>
        </Link>

        {/* Desktop nav — full inline links, hidden below md */}
        <div className="hidden items-center gap-4 md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm hover:text-accent-500 transition-colors">
              {link.label}
            </Link>
          ))}
          <Link
            href="/auth/login"
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent-600"
          >
            Login / Register
          </Link>
        </div>

        {/* Mobile burger — hidden at md and up */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-white transition hover:bg-white/10 md:hidden"
        >
          <Menu size={24} />
        </button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col p-0">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-1 p-3">
            {NAV_LINKS.map((link) => (
              <SheetClose asChild key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-[44px] items-center rounded-lg px-3 text-base font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  {link.label}
                </Link>
              </SheetClose>
            ))}
            <SheetClose asChild>
              <Link
                href="/auth/login"
                className="mt-2 flex min-h-[44px] items-center justify-center rounded-lg bg-accent-500 px-3 text-base font-semibold text-white transition hover:bg-accent-600"
              >
                Login / Register
              </Link>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
