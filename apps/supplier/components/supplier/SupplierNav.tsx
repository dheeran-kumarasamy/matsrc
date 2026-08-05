"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";


const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/listings", label: "Listings" },
  { href: "/orders", label: "Orders" },
  { href: "/rfqs", label: "RFQs" },
  { href: "/reports/market-intelligence", label: "Market Intelligence" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/profile", label: "Profile & KYC" },
];

export function SupplierNav() {
  const pathname = usePathname();

  return (
    <aside className="panel sticky top-4 h-fit p-4">
      <Link
        href="/dashboard"
        className="relative block h-20 w-full overflow-hidden rounded-xl bg-white p-3 transition hover:opacity-90"
      >
        <Image src="/icons/logo-full.png" alt="Buildohub" fill className="object-contain" priority />
      </Link>



      <nav className="mt-4 space-y-1">
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
