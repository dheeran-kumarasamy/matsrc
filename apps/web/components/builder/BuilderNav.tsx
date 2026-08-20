"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";


import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";


// Grouped by mental model (Overview / Procurement / Intelligence /
// Operations) rather than one flat list, so the nav communicates what the
// user can do at a glance. Routes/labels are unchanged — only the grouping
// and section headings are new.
const linkGroups: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Overview",
    links: [{ href: "/newdashboard", label: "Dashboard" }],
  },
  {
    heading: "Procurement",
    links: [
      { href: "/products", label: "Browse Materials" },
      { href: "/sourcing", label: "AI Sourcing Assistant" },
      { href: "/sites", label: "Sites" },
    ],
  },
  {
    heading: "Intelligence",
    links: [{ href: "/watchlist", label: "Watchlist" }],
  },
  {
    heading: "Operations",
    links: [
      { href: "/orders", label: "My Orders" },
      { href: "/purchase-orders", label: "Purchase Orders" },
      { href: "/disputes", label: "Disputes" },
    ],
  },
];

// Shared by BOTH the desktop sidebar (BuilderNav) and the mobile Sheet drawer
// (BuilderNavMobileTrigger), so the typography below applies on every screen
// size. Weights are set explicitly because the global `body` rule in
// globals.css is `font-weight: 300` — without them the nav renders thin.
function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-4">
      {linkGroups.map((group) => (
        <div key={group.heading} className="space-y-1">
          <p className="posh-nav-eyebrow px-4 pb-1.5 pt-1">{group.heading}</p>
          {group.links.map((link) => {
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
        </div>
      ))}
    </nav>
  );
}

function BrandBlock() {
  return (
    <Link
      href="/"
      className="relative block h-20 w-full overflow-hidden rounded-xl p-3 transition hover:opacity-90"
      style={{ background: "var(--posh-cream)" }}
    >
      <Image src="/icons/logo-full.png" alt="Buildohub" fill className="object-contain" priority />
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
            <SheetTitle className="posh-nav-brandmark text-2xl">Builder Hub</SheetTitle>
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

  return (
    <aside className="panel sticky top-4 hidden h-fit space-y-4 p-4 lg:block">
      <BrandBlock />
      <NavLinks pathname={pathname} />
    </aside>
  );
}

