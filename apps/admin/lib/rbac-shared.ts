// Client-safe RBAC constants and pure helpers.
// This module must NOT import anything server-only (e.g. "@/auth" / "@/lib/password"),
// since it is imported by client components ("use client").

export type AdminMenuGroup = "overview" | "supplier" | "buyer" | "admin";

export const MENU_CONFIG = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", group: "overview" },
  { key: "vendors", href: "/vendors", label: "Vendor Approval", group: "supplier" },
  { key: "kyc", href: "/kyc", label: "KYC Queue", group: "supplier" },
  { key: "supplier-invoices", href: "/supplier-invoices", label: "Supplier Invoices", group: "supplier" },
  { key: "buyers", href: "/buyers", label: "Buyer Credit Terms", group: "buyer" },
  { key: "payments", href: "/payments", label: "Payment Verification", group: "buyer" },
  { key: "advance-payments", href: "/advance-payments", label: "Advance Payments", group: "buyer" },
  { key: "orders", href: "/orders", label: "Orders & RFQs", group: "admin" },
  { key: "disputes", href: "/disputes", label: "Disputes", group: "admin" },
  { key: "aggregation", href: "/aggregation", label: "Aggregation Pools", group: "admin" },
  { key: "catalog", href: "/catalog", label: "Catalog Master Data", group: "admin" },
  { key: "markup", href: "/markup", label: "Product Markup", group: "admin" },
  { key: "gst", href: "/gst", label: "GST & Advance Configuration", group: "admin" },
  { key: "pricing", href: "/pricing", label: "Price Intelligence", group: "admin" },
  { key: "notifications", href: "/notifications", label: "Notification Engine", group: "admin" },
  { key: "whatsapp-alerts", href: "/whatsapp-alerts", label: "WhatsApp Alerts (Test)", group: "admin" },
  { key: "audit", href: "/audit", label: "Audit Logs", group: "admin" },
  { key: "access", href: "/access", label: "Access Control", group: "admin" },
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
