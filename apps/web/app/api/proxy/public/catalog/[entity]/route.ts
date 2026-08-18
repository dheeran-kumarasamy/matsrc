import { prisma } from "@/lib/prisma";

// NOTE: These endpoints must always be served dynamically (no-store).
// This codebase previously shipped a production bug where a public listings
// route regressed to stale/cached rendering. Do not remove these headers.
const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

const VALID_ENTITIES = ["category", "brand", "grade", "unit"] as const;
type Entity = (typeof VALID_ENTITIES)[number];

export const dynamic = "force-dynamic";

/**
 * Direct-Prisma implementation of the public catalog master-data endpoint
 * (Category/Brand/Grade/Unit dropdowns).
 *
 * This route intentionally overrides the generic `/api/proxy/[...slug]` catch-all,
 * which proxies to the standalone NestJS API via `BACKEND_API_URL`. That backend is
 * not always deployed/reachable (defaults to `http://localhost:4000/api`), which
 * caused `GET /api/public/catalog/:entity` requests from CategoryGrid.tsx and
 * ProductFilters.tsx (both of which hit `NEXT_PUBLIC_API_URL`, same default) to fail
 * with `net::ERR_CONNECTION_REFUSED` in production. See
 * `apps/api/src/admin/catalog/public-catalog.controller.ts` for the reference
 * implementation this mirrors.
 */
export async function GET(_req: Request, { params }: { params: { entity: string } }) {
  const { entity } = params;

  if (!VALID_ENTITIES.includes(entity as Entity)) {
    return Response.json(
      { error: `Unknown catalog entity: ${entity}` },
      { status: 400, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }

  try {
    let rows;
    switch (entity as Entity) {
      case "category": {
        // P1 fix (Category Discovery): only surface categories that actually
        // have at least one active listing. An admin can mark a Category
        // isActive=true with zero live Products under it (e.g. newly added,
        // or every listing since deactivated) — without this filter the
        // homepage/PLP would show a tile/filter option that always leads to
        // an empty "No products found" result. `some: { isActive: true }`
        // is a single indexed EXISTS-style query, not an N+1 fan-out.
        //
        // P2-B (Category Discovery imagery): additionally exposes imageUrl
        // (real, admin/backfill-set only — see Category.imageUrl's schema
        // comment; never fabricated here) and a real activeListingCount so
        // the homepage card can show truthful availability instead of
        // fabricating a number. One extra _count aggregate per category,
        // still no N+1 (Prisma batches this into the same query).
        rows = await prisma.category.findMany({
          where: { isActive: true, products: { some: { isActive: true } } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            slug: true,
            isActive: true,
            imageUrl: true,
            _count: { select: { products: { where: { isActive: true } } } },
          },
        });
        rows = rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          isActive: r.isActive,
          imageUrl: r.imageUrl,
          activeListingCount: r._count.products,
        }));
        break;
      }
      case "brand":
        rows = await prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
        break;
      case "grade":
        rows = await prisma.grade.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
        break;
      case "unit":
        rows = await prisma.unit.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
        break;
    }

    return Response.json(rows, { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } });
  } catch (error) {
    console.error("Failed to fetch public catalog options:", error);
    return Response.json(
      { error: "Failed to fetch catalog options" },
      { status: 500, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }
}
