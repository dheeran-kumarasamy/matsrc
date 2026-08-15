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


const links = [
  { href: "/newdashboard", label: "Dashboard" },
  { href: "/sourcing", label: "AI Sourcing Assistant" },
  { href: "/products", label: "Browse Materials" },
  { href: "/orders", label: "My Orders" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/cart", label: "Cart" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/sites", label: "Sites" },
  { href: "/reports", label: "Reports" },

  { href: "/disputes", label: "Disputes" },
];


// Shared by BOTH the desktop sidebar (BuilderNav) and the mobile Sheet drawer
// (BuilderNavMobileTrigger), so the typography below applies on every screen
// size. Weights are set explicitly because the global `body` rule in
// globals.css is `font-weight: 300` — without them the nav renders thin.
function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      <p className="posh-nav-eyebrow px-4 pb-1.5 pt-1">Navigation</p>
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`relative flex min-h-[44px] items-center rounded-xl px-4 text-[13px] tracking-[0.01em] transition-all duration-200 ${
              active
                ? "bg-black/[0.06] font-bold text-black shadow-sm ring-1 ring-inset ring-black/10"
                : "font-semibold text-black/55 hover:bg-black/[0.03] hover:font-bold hover:text-black"
            }`}
          >
            {/* Posh accent rail on the active item */}
            {active ? (
              <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-black" />
            ) : null}
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

function BrandBlock() {
  return (
    <Link
      href="/"
      className="relative block h-20 w-full overflow-hidden rounded-xl bg-white p-3 transition hover:opacity-90"
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
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-black/15 bg-white text-black transition hover:border-black lg:hidden"
      >
        <Menu size={20} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col border border-black/10 bg-white p-0">
          <SheetHeader>
            <SheetTitle className="posh-nav-brandmark text-2xl text-black">Builder Hub</SheetTitle>
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

