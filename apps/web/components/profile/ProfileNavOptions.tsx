import Link from "next/link";
import { MapPin, Bookmark, FileText, AlertCircle } from "lucide-react";

export const PROFILE_NAV_OPTIONS = [
  { href: "/sites", label: "Sites", icon: MapPin },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/purchase-orders", label: "Purchase orders", icon: FileText },
  { href: "/disputes", label: "Disputes", icon: AlertCircle },
];

export default function ProfileNavOptions() {
  return (
    <nav
      aria-label="Profile navigation options"
      className="grid grid-cols-4 gap-2 sm:gap-3 w-full"
    >
      {PROFILE_NAV_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        return (
          <Link
            key={opt.href}
            href={opt.href}
            className="panel flex items-center justify-center gap-1.5 sm:gap-2.5 rounded-xl px-2 sm:px-4 py-3 text-xs sm:text-sm font-semibold tracking-[0.01em] transition hover:border-[color:var(--posh-primary)] hover:bg-[rgba(var(--posh-wash-rgb),0.04)] hover:shadow-sm"
            style={{ color: "var(--posh-fg)" }}
          >
            <Icon size={16} className="shrink-0 text-[color:var(--posh-fg-muted)]" />
            <span className="truncate">{opt.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

