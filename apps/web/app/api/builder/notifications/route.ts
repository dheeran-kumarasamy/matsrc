import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx, resolveUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// GET /api/builder/notifications
// Backs the bell-icon dropdown (see NotificationBell.tsx). Re-uses the
// existing Notification table — every order status change (accepted,
// declined, dispatched, out-for-delivery, delivered, best-price selected,
// aggregation events) already writes a row here via NotificationService in
// apps/api, so no new write path is needed — this just surfaces them to the
// builder as in-app alerts.
export async function GET(request: Request) {
  try {
    let ctx: any = null;
    try {
      ctx = await resolveUserCtx(request);
    } catch {
      ctx = getUserCtx(request);
    }

    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const userIds = Array.from(new Set([user.id, ctx.userId, ctx.email].filter(Boolean)));

    let rows: any[] = [];
    let unreadCount = 0;

    try {
      [rows, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: { userId: { in: userIds } },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            title: true,
            body: true,
            read: true,
            createdAt: true,
            templateType: true,
            variables: true,
          },
        }),
        prisma.notification.count({ where: { userId: { in: userIds }, read: false } }),
      ]);
    } catch (dbErr: any) {
      console.warn("Notification query fallback without template columns:", dbErr?.message);
      try {
        [rows, unreadCount] = await Promise.all([
          prisma.notification.findMany({
            where: { userId: { in: userIds } },
            orderBy: { createdAt: "desc" },
            take: 30,
            select: {
              id: true,
              title: true,
              body: true,
              read: true,
              createdAt: true,
            },
          }),
          prisma.notification.count({ where: { userId: { in: userIds }, read: false } }),
        ]);
      } catch {
        rows = [];
        unreadCount = 0;
      }
    }

    // Order-status notifications (submitted/accepted/declined/dispatched/
    // out-for-delivery/delivered + best-price-ready) carry the source
    // orderId inside the JSON `variables` blob written by NotificationService
    // in apps/api. Surface it here as `orderId` so the bell dropdown can
    // deep-link straight into that order's detail overlay when clicked.
    const items = rows.map(({ templateType, variables, ...rest }) => {
      let orderId: string | null = null;
      if (variables) {
        try {
          const parsed = JSON.parse(variables) as { orderId?: string };
          orderId = parsed?.orderId || null;
        } catch {
          orderId = null;
        }
      }
      return { ...rest, orderId };
    });

    return NextResponse.json({ items, unreadCount });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED" || error?.message?.includes("UNAUTHENTICATED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Notifications GET error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch notifications",
        message: error?.message || "Failed to fetch notifications",
        code: error?.code,
      },
      { status: 500 }
    );
  }
}

// PATCH /api/builder/notifications  { all: true }
// Marks every unread notification for the current builder as read
// ("Mark all as read" action in the dropdown).
export async function PATCH(request: Request) {
  try {
    let ctx: any = null;
    try {
      ctx = await resolveUserCtx(request);
    } catch {
      ctx = getUserCtx(request);
    }
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const userIds = Array.from(new Set([user.id, ctx.userId, ctx.email].filter(Boolean)));
    const body = await request.json().catch(() => ({}));

    if (body?.all) {
      await prisma.notification.updateMany({
        where: { userId: { in: userIds }, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported request" }, { status: 400 });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED" || error?.message?.includes("UNAUTHENTICATED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Notifications PATCH error:", error);
    return NextResponse.json(
      {
        error: "Failed to update notifications",
        message: error?.message || "Failed to update notifications",
        code: error?.code,
      },
      { status: 500 }
    );
  }
}
