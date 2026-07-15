import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  MENU_CONFIG,
  DEFAULT_ADMIN_MENUS,
  allMenus,
  menuHref,
  menuLabel,
  normalizeMenus,
  firstAllowedHref,
  type AdminMenu,
} from "@/lib/rbac-shared";

export {
  MENU_CONFIG,
  DEFAULT_ADMIN_MENUS,
  allMenus,
  menuHref,
  menuLabel,
  firstAllowedHref,
  type AdminMenu,
};

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
