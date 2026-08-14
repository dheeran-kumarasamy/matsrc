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
  { href: "/dashboard", label: "Dashboard" },
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
            className={`flex min-h-[44px] items-center rounded-xl px-4 text-sm transition-all duration-150 ${
              active
                ? "bg-blue-50 font-semibold text-blue-700 shadow-sm"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
          >
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
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-blue-700 hover:text-blue-700 lg:hidden"
      >
        <Menu size={20} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col p-0">
          <SheetHeader>
            <SheetTitle>Builder Hub</SheetTitle>
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

