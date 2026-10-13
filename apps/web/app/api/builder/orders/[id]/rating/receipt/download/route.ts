import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/builder/orders/[id]/rating/receipt/download
//
// Streams the raw receipt bytes to the AUTHENTICATED RATING-OWNING BUILDER
// only — never a public/static URL. Deliberately a separate route from the
// existing metadata-only GET at /rating/receipt (which intentionally never
// returns bytes), mirroring the existing admin payment-screenshot /
// invoice-PDF download pattern (bytes-serving routes are always distinct
// from metadata/JSON routes in this codebase).
//
// Uses resolveUserCtx (not getUserCtx) because this route is hit via a
// plain <a href> download link, not a fetch()-based builderApi* call —
// browser navigations cannot attach the custom X-User-* headers, so
// resolveUserCtx falls back to the NextAuth session cookie (see
// lib/builder-db.ts, same convention as the advance-receipt PDF route).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    // Ownership check: the order must belong to the authenticated caller —
    // a builder can never download another builder's receipt by supplying
    // a different orderId, even if that orderId is otherwise valid.
    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const rating = await prisma.supplierRating.findUnique({
      where: { orderId: order.id },
      select: { receiptData: true, receiptMimeType: true, receiptFileName: true },
    });

    if (!rating || !rating.receiptData || !rating.receiptMimeType || !rating.receiptFileName) {
      return NextResponse.json({ error: "No receipt found for this order" }, { status: 404 });
    }

    return new NextResponse(Buffer.from(rating.receiptData) as unknown as BodyInit, {
      headers: {
        "Content-Type": rating.receiptMimeType,
        "Content-Disposition": `inline; filename="${rating.receiptFileName}"`,
        // Never cached/publicly stored — this is a private financial document.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Rating receipt download error:", error);
    return NextResponse.json({ error: "Failed to download receipt" }, { status: 500 });
  }
}
