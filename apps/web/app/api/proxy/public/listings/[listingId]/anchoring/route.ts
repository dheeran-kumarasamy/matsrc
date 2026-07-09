import { prisma } from "@/lib/prisma";
import { ProductInterestEventType } from "@matsrc/db";

// NOTE: These endpoints must always be served dynamically (no-store).
// This codebase previously shipped a production bug where a public listings
// route regressed to stale/cached rendering. Do not remove these headers.
const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

const INTEREST_WINDOW_HOURS = 24;
const MIN_SAMPLE_SIZE = 20;

export const dynamic = "force-dynamic";

/**
 * Direct-Prisma implementation of the listing anchoring endpoint.
 *
 * This route intentionally overrides the generic `/api/proxy/[...slug]` catch-all,
 * which proxies to the standalone NestJS API via `BACKEND_API_URL`. That backend is
 * not always deployed/reachable (defaults to `http://localhost:4000/api`), which
 * caused this endpoint to fail with a 500 in production. See
 * `apps/api/src/public-insights/public-insights.service.ts` for the reference
 * implementation this mirrors.
 */
export async function GET(_req: Request, { params }: { params: { listingId: string } }) {
  const { listingId } = params;

  try {
    const from = new Date(Date.now() - INTEREST_WINDOW_HOURS * 60 * 60 * 1000);

    const [viewSessions, orderSessions] = await Promise.all([
      prisma.productInterestEvent.findMany({
        where: { listingId, eventType: ProductInterestEventType.VIEW, createdAt: { gte: from } },
        distinct: ["sessionId"],
        select: { sessionId: true },
      }),
      prisma.productInterestEvent.findMany({
        where: { listingId, eventType: ProductInterestEventType.ORDER_PLACED, createdAt: { gte: from } },
        distinct: ["sessionId"],
        select: { sessionId: true },
      }),
    ]);

    const viewersLast24h = viewSessions.length;

    if (viewersLast24h < MIN_SAMPLE_SIZE) {
      return Response.json(
        { viewersLast24h, lockedPercent: null },
        { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
      );
    }

    const viewSet = new Set(viewSessions.map((session) => session.sessionId));
    const lockedSessions = orderSessions.filter((session) => viewSet.has(session.sessionId)).length;
    const lockedPercent = Math.max(0, Math.min(100, Math.round((lockedSessions / viewersLast24h) * 100)));

    return Response.json(
      { viewersLast24h, lockedPercent },
      { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error("Failed to fetch anchoring insights:", error);
    return Response.json(
      { error: "Failed to fetch anchoring insights" },
      { status: 500, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }
}
