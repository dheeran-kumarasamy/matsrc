"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, MapPin, Bookmark, FileText, AlertCircle } from "lucide-react";

export const PROFILE_NAV_OPTIONS = [
  { href: "/profile", label: "Profile", icon: User },
  { href: "/sites", label: "Sites", icon: MapPin },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/purchase-orders", label: "Purchase orders", icon: FileText },
  { href: "/disputes", label: "Disputes", icon: AlertCircle },
];

export default function ProfileNavOptions() {
  const pathname = usePathname() || "";

  const isActive = (href: string) => {
    if (href === "/profile") {
      return pathname === "/profile" || pathname.startsWith("/profile/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav
      aria-label="Profile navigation options"
      className="grid grid-cols-5 gap-1.5 sm:gap-3 w-full"
    >
      {PROFILE_NAV_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = isActive(opt.href);
        return (
          <Link
            key={opt.href}
            href={opt.href}
            aria-current={active ? "page" : undefined}
            className={`panel flex items-center justify-center gap-1.5 sm:gap-2.5 rounded-xl px-1.5 sm:px-4 py-2.5 sm:py-3 text-[11px] sm:text-sm tracking-[0.01em] transition ${
              active
                ? "border-[color:var(--posh-primary)] bg-[rgba(var(--posh-wash-rgb),0.08)] font-bold shadow-sm ring-1 ring-[color:var(--posh-primary)]"
                : "font-semibold hover:border-[color:var(--posh-primary)] hover:bg-[rgba(var(--posh-wash-rgb),0.04)] hover:shadow-sm"
            }`}
            style={{ color: "var(--posh-fg)" }}
          >
            <Icon
              size={16}
              className={`shrink-0 transition-colors ${
                active ? "text-[color:var(--posh-primary)]" : "text-[color:var(--posh-fg-muted)]"
              }`}
            />
            <span className="truncate">{opt.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
