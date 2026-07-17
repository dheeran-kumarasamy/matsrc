import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// Shared icon-button styling for the search-bar row's Bell/Report entries so
// they visually match the existing CartLauncher pill (REQ-03/04/05).
export default function HeaderIconLink({
  href,
  label,
  icon: Icon,
  ariaLabel,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  ariaLabel: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="relative flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-blue-700 hover:text-blue-700"
    >
      <Icon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
