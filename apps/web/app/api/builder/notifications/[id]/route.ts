import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// PATCH /api/builder/notifications/[id]  { read: true }
// Marks a single alert as read when the builder clicks it in the bell
// dropdown (NotificationBell.tsx).
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

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
    console.error("Notification PATCH error:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}
