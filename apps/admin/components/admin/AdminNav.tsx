"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";


type NavLink = { href: string; label: string };

export function AdminNav({
  links,
  userName,
  role,
}: {
  links: NavLink[];
  userName: string;
  role: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="panel sticky top-4 h-fit p-4">
      <Link
        href="/dashboard"
        className="relative block h-20 w-full overflow-hidden rounded-xl bg-white p-3 transition hover:opacity-90"
      >
        <Image src="/icons/logo-full.png" alt="Buildohub" fill className="object-contain" priority />
      </Link>



      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Signed in as</p>
        <p className="mt-1 text-sm font-bold text-slate-900">{userName}</p>
        <p className="mt-1 inline-flex rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
          {role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
        </p>
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
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: "/sign-in" })}
        className="mt-6 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
      >
        Sign Out
      </button>
    </aside>
  );
}