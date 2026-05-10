import { prisma } from "@matsrc/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { allMenus, DEFAULT_ADMIN_MENUS, type AdminMenu } from "@/lib/rbac";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!actor || actor.role !== "SUPER_ADMIN") {
    return NextResponse.json({ message: "Only super admin can assign permissions" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!target) {
    return NextResponse.json({ message: "Admin user not found" }, { status: 404 });
  }

  if (target.role === "SUPER_ADMIN") {
    return NextResponse.json({ message: "Super admin already has full access" }, { status: 400 });
  }

  if (target.role !== "ADMIN") {
    return NextResponse.json({ message: "Target user is not an admin" }, { status: 400 });
  }

  const body = (await request.json()) as { menus?: string[] };
  const allow = new Set(allMenus());

  const incoming = Array.isArray(body.menus) ? body.menus : [];
  const menus = incoming.filter((menu): menu is AdminMenu => allow.has(menu as AdminMenu));
  const finalMenus = menus.length > 0 ? menus : DEFAULT_ADMIN_MENUS;

  await prisma.$transaction([
    prisma.adminMenuPermission.deleteMany({ where: { userId: target.id } }),
    prisma.adminMenuPermission.createMany({
      data: finalMenus.map((menu) => ({ userId: target.id, menu })),
    }),
  ]);

  return NextResponse.json({ ok: true, menus: finalMenus });
}
