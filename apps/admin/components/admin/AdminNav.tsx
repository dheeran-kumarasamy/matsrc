"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import type { AdminMenuGroup } from "@/lib/rbac-shared";

type NavLink = { href: string; label: string; group?: AdminMenuGroup };

const GROUP_SECTIONS: Array<{ key: Exclude<AdminMenuGroup, "overview">; title: string }> = [
  { key: "supplier", title: "Supplier" },
  { key: "buyer", title: "Buyer" },
  { key: "admin", title: "Admin" },
];

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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isLinkActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const overviewLinks = links.filter((link) => (link.group ?? "admin") === "overview");
  const groupedSections = GROUP_SECTIONS.map((section) => ({
    ...section,
    items: links.filter((link) => (link.group ?? "admin") === section.key),
  })).filter((section) => section.items.length > 0);

  const toggleSection = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderNavLink = (link: NavLink) => {
    const active = isLinkActive(link.href);
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
  };

  return (
    <aside className="panel sticky top-4 flex max-h-[calc(100vh-2rem)] flex-col p-4">
      <Link
        href="/dashboard"
        className="relative block h-20 w-full shrink-0 overflow-hidden rounded-xl bg-white p-3 transition hover:opacity-90"
      >
        <Image src="/icons/logo-full.png" alt="Buildohub" fill className="object-contain" priority />
      </Link>

      <div className="mt-4 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Signed in as</p>
        <p className="mt-1 text-sm font-bold text-slate-900">{userName}</p>
        <p className="mt-1 inline-flex rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
          {role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
        </p>
      </div>

      <nav aria-label="Admin Navigation" className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
        {overviewLinks.length > 0 ? (
          <div className="space-y-1">{overviewLinks.map(renderNavLink)}</div>
        ) : null}

        {groupedSections.map((section) => {
          const hasActiveItem = section.items.some((item) => isLinkActive(item.href));
          const isOpen = hasActiveItem || !collapsed[section.key];

          return (
            <div key={section.key} className="border-t border-slate-200/80 pt-3">
              <button
                type="button"
                onClick={() => toggleSection(section.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between px-3 py-1 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 transition hover:text-slate-700"
              >
                <span>{section.title}</span>
                <span className="text-xs font-semibold leading-none">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen ? <div className="mt-1.5 space-y-1">{section.items.map(renderNavLink)}</div> : null}
            </div>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: "/sign-in" })}
        className="mt-4 w-full shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
      >
        Sign Out
      </button>
    </aside>
  );
}