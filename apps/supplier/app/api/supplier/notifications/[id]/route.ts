import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/supplier/notifications/[id]  { read: true }
// Marks a single alert as read when the supplier clicks it in the bell
// dropdown (components/supplier/NotificationBell.tsx) — mirrors apps/web's
// identical /api/builder/notifications/[id] route.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { user } = await ensureSupplierContext(email);

    const existing = await prisma.notification.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    const updated = await prisma.notification.update({
      where: { id: params.id },
      data: { read: true },
      select: { id: true, read: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Supplier notification PATCH error:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}
