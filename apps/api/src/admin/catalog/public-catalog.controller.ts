import { BadRequestException, Controller, Get, Param } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

const VALID_ENTITIES = ["category", "brand", "grade", "unit"] as const;
type Entity = (typeof VALID_ENTITIES)[number];

// Public, unauthenticated read endpoint so the supplier and builder apps can populate
// their Category/Brand/Grade/Unit dropdowns from the same admin-managed master data.
// Read-only — no guards, only active rows are returned.
@Controller("public/catalog")
export class PublicCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":entity")
  async findActive(@Param("entity") entity: string) {
    if (!VALID_ENTITIES.includes(entity as Entity)) {
      throw new BadRequestException(`Unknown catalog entity: ${entity}`);
    }

    switch (entity as Entity) {
      case "category":
        return this.prisma.category.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
      case "brand":
        return this.prisma.brand.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
      case "grade":
        return this.prisma.grade.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
      case "unit":
        return this.prisma.unit.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        });
    }
  }
}
