"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/vendors", label: "Vendor Approval" },
  { href: "/kyc", label: "KYC Queue" },
  { href: "/disputes", label: "Disputes" },
  { href: "/audit", label: "Audit Logs" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <aside className="panel sticky top-4 h-fit p-4">
      <div className="rounded-xl bg-[linear-gradient(120deg,#0f172a,#1a4f8a)] p-4 text-white">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">BuildMart</p>
        <h1 className="mt-1 text-xl font-extrabold">Admin Command</h1>
      </div>
      <nav className="mt-4 space-y-1">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-lg px-3 py-2 text-sm font-semibold transition ${
                active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
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