import { prisma } from "@matsrc/db";
import { AdminAccessManager } from "@/components/admin/AdminAccessManager";
import { allMenus, requireMenu, type AdminMenu } from "@/lib/rbac";
import { redirect } from "next/navigation";

export default async function AccessControlPage() {
  const access = await requireMenu("access");
  if (access.role !== "SUPER_ADMIN") {
    redirect("/forbidden");
  }

  const users = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    include: { adminMenuPermissions: true },
    orderBy: { createdAt: "asc" },
  });
  type AccessUser = (typeof users)[number];

  const menus = allMenus();

  const payload = users.map((user: AccessUser) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as "ADMIN" | "SUPER_ADMIN",
    menus:
      user.role === "SUPER_ADMIN"
        ? menus
        : user.adminMenuPermissions
            .map((p: { menu: string }) => p.menu)
            .filter((m): m is AdminMenu => menus.includes(m as AdminMenu)),
  }));

  return <AdminAccessManager users={payload} allMenus={menus} />;
}
