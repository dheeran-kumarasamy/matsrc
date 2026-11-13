import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/supplier/notifications
//
// Supplier-portal Alerts bell (see components/supplier/NotificationBell.tsx)
// — mirrors apps/web's identical /api/builder/notifications route/UI
// pattern exactly, scoped to the authenticated supplier's own userId.
//
// Re-uses the EXISTING Notification table — every supplier-facing event
// already writes a row here today (e.g. apps/web's
// notifySupplierOrderSubmitted / notifySupplierPurchaseOrderGenerated, and
// apps/supplier's own notifySupplierOrderSubmittedForCandidate — see
// lib/supplier-data.ts), so no new write path is needed; this is purely the
// first in-app surface that reads them back for the supplier.
export async function GET(request: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { user } = await ensureSupplierContext(email);

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          title: true,
          body: true,
          read: true,
          createdAt: true,
          variables: true,
        },
      }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ]);

    // Order-related alerts (new RFQ, PO generated, candidate-promotion
    // reassignment) carry the source orderId inside the JSON `variables`
    // blob written by whichever notify* writer created the row (see
    // apps/web/lib/notify.ts / apps/supplier/lib/supplier-data.ts). Surface
    // it here as `orderId` so the bell dropdown can deep-link straight into
    // that order's detail page when clicked — mirrors apps/web's identical
    // mapping in /api/builder/notifications.
    const items = rows.map(({ variables, ...rest }) => {
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
  } catch (error) {
    console.error("Supplier notifications GET error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

// PATCH /api/supplier/notifications  { all: true }
// Marks every unread notification for the current supplier as read
// ("Mark all as read" action in the dropdown).
export async function PATCH(request: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { user } = await ensureSupplierContext(email);
    const body = await request.json().catch(() => ({}));

    if (body?.all) {
      await prisma.notification.updateMany({
        where: { userId: user.id, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported request" }, { status: 400 });
  } catch (error) {
    console.error("Supplier notifications PATCH error:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}
