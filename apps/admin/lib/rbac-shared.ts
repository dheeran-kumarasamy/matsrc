// Client-safe RBAC constants and pure helpers.
// This module must NOT import anything server-only (e.g. "@/auth" / "@/lib/password"),
// since it is imported by client components ("use client").

export const MENU_CONFIG = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "vendors", href: "/vendors", label: "Vendor Approval" },
  { key: "kyc", href: "/kyc", label: "KYC Queue" },
  { key: "disputes", href: "/disputes", label: "Disputes" },
  { key: "aggregation", href: "/aggregation", label: "Aggregation Pools" },
  { key: "catalog", href: "/catalog", label: "Catalog Master Data" },
  { key: "audit", href: "/audit", label: "Audit Logs" },
  { key: "access", href: "/access", label: "Access Control" },
] as const;

export type AdminMenu = (typeof MENU_CONFIG)[number]["key"];

export const DEFAULT_ADMIN_MENUS: AdminMenu[] = ["dashboard"];

export function allMenus(): AdminMenu[] {
  return MENU_CONFIG.map((item) => item.key);
}

export function menuHref(menu: AdminMenu): string {
  return MENU_CONFIG.find((item) => item.key === menu)?.href || "/dashboard";
}

export function menuLabel(menu: AdminMenu): string {
  return MENU_CONFIG.find((item) => item.key === menu)?.label || menu;
}

export function normalizeMenus(menus: string[]): AdminMenu[] {
  const allowed = new Set(allMenus());
  return menus.filter((menu): menu is AdminMenu => allowed.has(menu as AdminMenu));
}

export function firstAllowedHref(menus: AdminMenu[]): string {
  if (menus.length === 0) return "/forbidden";
  return menuHref(menus[0]);
}
