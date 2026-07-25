import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// BUG-02: Disputes list/create — FR-16.
// Local Next.js route handler (direct-Prisma), mirroring the existing
// pattern used by orders/cart/watchlist in this app. This route previously
// did not exist at all, so both the disputes list page and the "Raise a
// Dispute" form were silently 404-ing (list fell back to an empty array;
// the form's POST failed with a generic error).
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const disputes = await prisma.dispute.findMany({
      // Scoped strictly to the current user's own disputes — prevents any
      // cross-user data leakage.
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      disputes.map((d) => ({
        id: d.id,
        orderId: d.orderId,
        issueType: d.issueType,
        description: d.description,
        status: d.status,
        createdAt: d.createdAt,
      }))
    );
  } catch (error) {
    console.error("Disputes GET error:", error);
    return NextResponse.json({ error: "Failed to fetch disputes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const orderId: string | undefined = body?.orderId;
    const issueType: string | undefined = body?.issueType;
    const description: string | undefined = body?.description;

    if (!orderId || !issueType || !description) {
      return NextResponse.json(
        { error: "orderId, issueType and description are required" },
        { status: 400 }
      );
    }

    // Confirm the order both exists AND belongs to the requesting user —
    // otherwise a builder could raise a dispute against another user's
    // order by guessing/forging an orderId.
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Dispute.orderId is unique (1 dispute per order) — surface a clean
    // error instead of a raw Prisma unique-constraint failure.
    const existing = await prisma.dispute.findUnique({ where: { orderId } });
    if (existing) {
      return NextResponse.json(
        { error: "A dispute has already been raised for this order" },
        { status: 409 }
      );
    }

    const dispute = await prisma.dispute.create({
      data: {
        orderId,
        userId: user.id,
        issueType,
        description,
      },
    });

    return NextResponse.json({ id: dispute.id }, { status: 201 });
  } catch (error) {
    console.error("Disputes POST error:", error);
    return NextResponse.json({ error: "Failed to raise dispute" }, { status: 500 });
  }
}
