import { Role, prisma } from "@matsrc/db";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/password";
import { allMenus, DEFAULT_ADMIN_MENUS } from "@/lib/rbac";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
    };

    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!name || !email || password.length < 8) {
      return NextResponse.json(
        { message: "Name, valid email, and password (min 8 chars) are required" },
        { status: 400 }
      );
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ message: "Account already exists" }, { status: 409 });
    }

    const superAdminCount = await prisma.user.count({ where: { role: Role.SUPER_ADMIN } });
    const role = superAdminCount === 0 ? Role.SUPER_ADMIN : Role.ADMIN;
    const menus = role === Role.SUPER_ADMIN ? allMenus() : DEFAULT_ADMIN_MENUS;

    const passwordHash = await hashPassword(password);

    await prisma.user.create({
      data: {
        email,
        name,
        role,
        adminCredential: { create: { passwordHash } },
        adminMenuPermissions: {
          create: menus.map((menu) => ({ menu })),
        },
      },
    });

    return NextResponse.json({ ok: true, role });
  } catch {
    return NextResponse.json({ message: "Registration failed" }, { status: 500 });
  }
}
