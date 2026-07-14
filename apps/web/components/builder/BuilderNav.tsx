"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import ProductFilters from "@/components/products/ProductFilters";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";


const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Browse Materials" },
  { href: "/orders", label: "My Orders" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/cart", label: "Cart" },
  { href: "/watchlist", label: "Watchlist" },
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
            className={`flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold transition ${
              active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
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
    <div className="rounded-xl bg-[linear-gradient(120deg,#1a4f8a,#e87722)] p-4 text-white">
      <p className="text-xs uppercase tracking-[0.2em] text-blue-100">BuildMart</p>
      <h1 className="mt-1 text-xl font-extrabold">Builder Hub</h1>
    </div>
  );
}

// Mobile burger button + Sheet drawer, mounted in the (builder) header.
// Desktop keeps the inline sidebar (rendered separately below); this is
// only visible below `lg`.
export function BuilderNavMobileTrigger() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const showProductFilters = pathname === "/products";

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
            {showProductFilters ? (
              <div className="border-t border-slate-100 pt-4">
                <ProductFilters
                  selectedCategory={searchParams.get("category") ?? undefined}
                  selectedBrand={searchParams.get("brand") ?? undefined}
                  minPrice={searchParams.get("minPrice") ?? undefined}
                  maxPrice={searchParams.get("maxPrice") ?? undefined}
                  q={searchParams.get("q") ?? undefined}
                  sort={searchParams.get("sort") ?? undefined}
                />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// Desktop sidebar — hidden below `lg`, visible inline at `lg` and up.
export function BuilderNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // FR-04: Show the Browse Materials filters directly below the main menu
  // when the builder is on the product discovery page.
  const showProductFilters = pathname === "/products";

  return (
    <aside className="panel sticky top-4 hidden h-fit space-y-4 p-4 lg:block">
      <BrandBlock />
      <NavLinks pathname={pathname} />

      {showProductFilters ? (
        <div className="border-t border-slate-100 pt-4">
          <ProductFilters
            selectedCategory={searchParams.get("category") ?? undefined}
            selectedBrand={searchParams.get("brand") ?? undefined}
            minPrice={searchParams.get("minPrice") ?? undefined}
            maxPrice={searchParams.get("maxPrice") ?? undefined}
            q={searchParams.get("q") ?? undefined}
            sort={searchParams.get("sort") ?? undefined}
          />
        </div>
      ) : null}
    </aside>
  );
}
