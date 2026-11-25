import { prisma } from "@matsrc/db";
import { ensurePricingSchema } from "@/lib/supplier-data";

const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

const VALID_ENTITIES = ["category", "brand", "grade", "unit"] as const;
type Entity = (typeof VALID_ENTITIES)[number];

export const dynamic = "force-dynamic";

/**
 * Direct-Prisma implementation of the public catalog master-data endpoint
 * (Category/Brand/Grade/Unit dropdowns) for the Supplier portal.
 *
 * This provides the master data directly from PostgreSQL via Prisma, matching the
 * public-catalog controller in apps/api and the proxy route in apps/web. This avoids
 * any dependence on external backend URLs or localhost:4000.
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
    await ensurePricingSchema();

    let rows;
    switch (entity as Entity) {
      case "category": {
        try {
          rows = await prisma.category.findMany({
            where: { isActive: true, isOrderable: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true, slug: true, isActive: true },
          });
        } catch {
          rows = await prisma.category.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true, slug: true, isActive: true },
          });
        }
        break;
      }
      case "brand":
        rows = await prisma.brand.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
        break;
      case "grade":
        rows = await prisma.grade.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
        break;
      case "unit":
        rows = await prisma.unit.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
        break;
    }

    return Response.json(rows, { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } });
  } catch (error) {
    console.error(`Failed to fetch catalog entity ${entity}:`, error);
    return Response.json(
      { error: "Failed to fetch catalog options" },
      { status: 500, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }
}
