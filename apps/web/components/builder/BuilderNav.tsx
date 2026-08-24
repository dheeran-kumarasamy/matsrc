"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";


import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import BuildOHubLogo from "@/components/shared/BuildOHubLogo";


// Flat list of nav links — previously grouped under "Overview" /
// "Procurement" / "Intelligence" / "Operations" section headings, which
// have been removed per request (redundant given how few links exist per
// group). All routes/labels/ordering are unchanged; only the group
// headings themselves are gone.
const links: { href: string; label: string }[] = [
  { href: "/newdashboard", label: "Dashboard" },
  // "Browse Materials" intentionally not listed here — it's always
  // reachable via the floating bottom-right shortcut on every page (see
  // components/builder/FloatingBrowseLink.tsx, now also mounted on
  // /newdashboard), so keeping it in the sidebar too was a duplicate
  // entry point to the same page.
  { href: "/sourcing", label: "AI Sourcing Assistant" },
  { href: "/sites", label: "Sites" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/orders", label: "My Orders" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/disputes", label: "Disputes" },
];

// Shared by BOTH the desktop sidebar (BuilderNav) and the mobile Sheet drawer
// (BuilderNavMobileTrigger), so the typography below applies on every screen
// size. Weights are set explicitly because the global `body` rule in
// globals.css is `font-weight: 300` — without them the nav renders thin.
function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`relative flex min-h-[44px] items-center rounded-xl border px-4 text-[13px] tracking-[0.01em] transition-all duration-200 ${
              active ? "font-bold shadow-sm" : "border-transparent font-semibold"
            }`}
            style={
              active
                ? {
                    background: "rgba(var(--posh-wash-rgb),0.08)",
                    color: "var(--posh-fg)",
                    borderColor: "var(--posh-border)",
                  }
                : { color: "var(--posh-fg-muted)" }
            }
            onMouseEnter={(e) => {
              if (!active) {
                (e.currentTarget as HTMLElement).style.background = "rgba(var(--posh-wash-rgb),0.04)";
                (e.currentTarget as HTMLElement).style.color = "var(--posh-fg)";
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--posh-fg-muted)";
              }
            }}
          >
            {/* Posh accent rail on the active item */}
            {active ? (
              <span
                className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full"
                style={{ background: "var(--posh-primary)" }}
              />
            ) : null}
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Flush full-width band at the top of the sidebar (no inset margin/rounded
// "floating pill" look), using the exact same vertical padding (py-3) as
// the header search-bar row it sits beside (see AppHeader's
// "panel sticky top-4 z-30 ... px-4 py-3" in app/(builder)/layout.tsx) —
// both are `sticky top-4`, so matching padding keeps their outer boxes the
// same height and their top/bottom edges aligned, matching how the logo
// and search bar already sit on one row on /newdashboard. A bottom border
// visually connects this band to the nav links below as one continuous
// sidebar container rather than a disconnected floating card.
function BrandBlock() {
  return (
    <Link
      href="/"
      className="flex w-full items-center justify-center border-b px-4 py-3 transition hover:opacity-90"
      style={{ background: "var(--posh-cream)", borderColor: "var(--posh-border)" }}
    >
      <BuildOHubLogo href={null} size="lg" />
    </Link>
  );
}





// Mobile burger button + Sheet drawer, mounted in the (builder) header.
export function BuilderNavMobileTrigger() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="flex h-11 w-11 items-center justify-center rounded-lg border transition lg:hidden"
        style={{ borderColor: "var(--posh-border)", background: "var(--posh-bg-card)", color: "var(--posh-fg)" }}
      >
        <Menu size={20} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="flex flex-col border-0 p-0"
          style={{ background: "var(--posh-bg-card)", color: "var(--posh-fg)" }}
        >
          <SheetHeader>
            <SheetTitle>
              <BuildOHubLogo href={null} size="lg" />
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <BrandBlock />
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}


// Desktop sidebar — hidden below `lg`, visible inline at `lg` and up.
// Shows the brand block + full navigation links. Recent Orders panel removed
// since order history is now surfaced inside the dashboard's Outstanding tab.
export function BuilderNav() {
  const pathname = usePathname();

  // BrandBlock is flush against the aside's own top/side edges (no wrapping
  // padding) and uses the same py-3 vertical padding as the header
  // search-bar row beside it, so both boxes render the same height and
  // align at the top/bottom (both are `sticky top-4`) instead of the brand
  // block sitting inset as a separate floating card. Nav links get their
  // own padding below it, so the grey brand band reads as part of one
  // continuous sidebar container.
  return (
    <aside className="panel sticky top-4 hidden h-fit overflow-hidden lg:block">
      <BrandBlock />
      <div className="space-y-4 p-4">
        <NavLinks pathname={pathname} />
      </div>
    </aside>
  );
}

