import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const MENU_CONFIG = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "vendors", href: "/vendors", label: "Vendor Approval" },
  { key: "kyc", href: "/kyc", label: "KYC Queue" },
  { key: "disputes", href: "/disputes", label: "Disputes" },
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

function normalizeMenus(menus: string[]): AdminMenu[] {
  const allowed = new Set(allMenus());
  return menus.filter((menu): menu is AdminMenu => allowed.has(menu as AdminMenu));
}

export async function getCurrentAdminAccess() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const user = session.user as {
    id?: string;
    email?: string | null;
    name?: string | null;
    role?: string;
    menus?: string[];
  };

  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return null;
  }

  const menus = normalizeMenus((user.menus as string[]) || []);

  return {
    id: user.id || "",
    email: user.email!,
    name: user.name || null,
    role: user.role as string,
    menus: menus.length > 0 ? menus : DEFAULT_ADMIN_MENUS,
  };
}

export async function requireAdminAccess() {
  const access = await getCurrentAdminAccess();
  if (!access) redirect("/sign-in");
  return access;
}

export async function requireMenu(menu: AdminMenu) {
  const access = await requireAdminAccess();
  if (!access.menus.includes(menu)) {
    redirect("/forbidden");
  }
  return access;
}

export function firstAllowedHref(menus: AdminMenu[]): string {
  if (menus.length === 0) return "/forbidden";
  return menuHref(menus[0]);
}
