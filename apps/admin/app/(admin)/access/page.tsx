import { Role, prisma } from "@matsrc/db";
import { AdminAccessManager } from "@/components/admin/AdminAccessManager";
import { allMenus, requireMenu, type AdminMenu } from "@/lib/rbac";
import { redirect } from "next/navigation";

export default async function AccessControlPage() {
  const access = await requireMenu("access");
  if (access.role !== Role.SUPER_ADMIN) {
    redirect("/forbidden");
  }

  const users = await prisma.user.findMany({
    where: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN] } },
    include: { adminMenuPermissions: true },
    orderBy: { createdAt: "asc" },
  });

  const menus = allMenus();

  const payload = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    menus:
      user.role === Role.SUPER_ADMIN
        ? menus
        : user.adminMenuPermissions
            .map((p) => p.menu)
            .filter((m): m is AdminMenu => menus.includes(m as AdminMenu)),
  }));

  return <AdminAccessManager users={payload} allMenus={menus} />;
}
