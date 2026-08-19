"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";


const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/listings", label: "Listings" },
  { href: "/orders", label: "Orders" },
  { href: "/rfqs", label: "RFQs" },
  { href: "/reports/market-intelligence", label: "Market Intelligence" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/profile", label: "Profile & KYC" },
];

// Primary sidebar navigation for the Supplier Portal. Rendered from
// `app/(supplier)/layout.tsx` so it's available on every authenticated
// supplier page (dashboard, listings, orders, etc.) — this is the only
// in-app path to `/listings` besides the dashboard's "Active Listings" KPI
// card and the FAB's "Add New Listing" shortcut.
export function SupplierNav() {
  const pathname = usePathname();

  return (
    <aside className="panel sticky top-4 h-fit p-3">
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
    </aside>
  );
}
