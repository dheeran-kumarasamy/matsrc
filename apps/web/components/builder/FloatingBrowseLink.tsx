"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

// BUG-03 fix: this floating "Browse Materials" shortcut previously rendered
// unconditionally inside app/(builder)/layout.tsx, so it appeared even on
// the Browse Materials page (/products) itself — redundant/overlapping
// with the page the user is already on. Hidden only on the exact /products
// list route; still shown on product detail pages (/products/[slug]) and
// every other builder route, matching the ticket's "shouldn't show on the
// Browse Products page itself" requirement.
export default function FloatingBrowseLink() {
  const pathname = usePathname();

  if (pathname === "/products") {
    return null;
  }

  return (
    <Link
      href="/products"
      className="fixed bottom-6 right-6 z-40 flex min-h-[44px] items-center gap-2 rounded-full bg-accent-500 px-5 py-3 text-sm font-medium text-[color:var(--posh-primary-fg)] shadow-lg transition-colors hover:bg-accent-600"
    >
      <Search size={18} />
      <span className="hidden sm:inline">Browse Materials</span>
    </Link>
  );
}
