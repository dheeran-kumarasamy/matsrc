import { prisma } from "@/lib/prisma";
import { ProductInterestEventType } from "@matsrc/db";

// NOTE: These endpoints must always be served dynamically (no-store).
// This codebase previously shipped a production bug where a public listings
// route regressed to stale/cached rendering. Do not remove these headers.
const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

const INTEREST_RATE_LIMIT_MS = 5 * 60 * 1000;

export const dynamic = "force-dynamic";

/**
 * Direct-Prisma implementation of the interest-event recording endpoint.
 *
 * This route intentionally overrides the generic `/api/proxy/[...slug]` catch-all,
 * which proxies to the standalone NestJS API via `BACKEND_API_URL`. That backend is
 * not always deployed/reachable (defaults to `http://localhost:4000/api`), which
 * caused this endpoint to silently fail in production. See
 * `apps/api/src/public-insights/public-insights.service.ts` for the reference
 * implementation this mirrors.
 */
export async function POST(req: Request, { params }: { params: { listingId: string } }) {
  const { listingId } = params;

  try {
    const body = await req.json().catch(() => ({}));
    const eventType = body?.eventType as ProductInterestEventType | undefined;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";

    if (!eventType || !Object.values(ProductInterestEventType).includes(eventType)) {
      return Response.json(
        { error: "A valid eventType is required" },
        { status: 400, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
      );
    }

    if (!sessionId) {
      return Response.json(
        { error: "sessionId is required" },
        { status: 400, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
      );
    }

    const listing = await prisma.product.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) {
      return Response.json(
        { error: "Listing not found" },
        { status: 404, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
      );
    }

    const rateLimitFrom = new Date(Date.now() - INTEREST_RATE_LIMIT_MS);
    const existing = await prisma.productInterestEvent.findFirst({
      where: {
        listingId,
        eventType,
        sessionId,
        createdAt: { gte: rateLimitFrom },
      },
      select: { id: true },
    });

    if (existing) {
      return Response.json(
        { accepted: true, deduplicated: true },
        { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
      );
    }

    await prisma.productInterestEvent.create({
      data: { listingId, eventType, sessionId },
    });

    return Response.json(
      { accepted: true, deduplicated: false },
      { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error("Failed to record interest event:", error);
    return Response.json(
      { error: "Failed to record interest event" },
      { status: 500, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }
}
