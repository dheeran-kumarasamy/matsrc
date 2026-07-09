"use client";


import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import ProductFilters from "@/components/products/ProductFilters";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Browse Materials" },
  { href: "/orders", label: "My Orders" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/cart", label: "Cart" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/disputes", label: "Disputes" },
];

export function BuilderNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // FR-04: Show the Browse Materials filters directly below the main menu
  // when the builder is on the product discovery page.
  const showProductFilters = pathname === "/products";

  return (
    <aside className="panel sticky top-4 h-fit space-y-4 p-4">
      <div className="rounded-xl bg-[linear-gradient(120deg,#1a4f8a,#e87722)] p-4 text-white">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-100">BuildMart</p>
        <h1 className="mt-1 text-xl font-extrabold">Builder Hub</h1>
      </div>
      <nav className="space-y-1">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-lg px-3 py-2 text-sm font-semibold transition ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

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
