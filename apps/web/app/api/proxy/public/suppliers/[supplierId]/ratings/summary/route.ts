import { prisma } from "@/lib/prisma";

// NOTE: These endpoints must always be served dynamically (no-store).
// This codebase previously shipped a production bug where a public listings
// route regressed to stale/cached rendering. Do not remove these headers.
const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

export const dynamic = "force-dynamic";

/**
 * Direct-Prisma implementation of the supplier ratings summary endpoint.
 *
 * This route intentionally overrides the generic `/api/proxy/[...slug]` catch-all,
 * which proxies to the standalone NestJS API via `BACKEND_API_URL`. That backend is
 * not always deployed/reachable (defaults to `http://localhost:4000/api`), which
 * caused this endpoint to fail with a 500 in production. See
 * `apps/api/src/public-insights/public-insights.service.ts` for the reference
 * implementation this mirrors.
 */
export async function GET(_req: Request, { params }: { params: { supplierId: string } }) {
  const { supplierId } = params;

  try {
    const aggregate = await prisma.supplierRating.aggregate({
      where: { supplierId },
      _count: { _all: true },
      _avg: {
        deliveryRating: true,
        qualityRating: true,
      },
    });

    const totalRatings = aggregate._count._all;
    const response = {
      avgDeliveryRating: aggregate._avg.deliveryRating ? Number(aggregate._avg.deliveryRating.toFixed(1)) : null,
      avgQualityRating: aggregate._avg.qualityRating ? Number(aggregate._avg.qualityRating.toFixed(1)) : null,
      totalRatings,
      insufficientData: totalRatings < 5,
    };

    return Response.json(response, {
      headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("Failed to fetch supplier ratings summary:", error);
    return Response.json(
      { error: "Failed to fetch supplier ratings summary" },
      { status: 500, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }
}
