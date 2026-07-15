import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

export type CatalogEntity = "category" | "brand" | "grade" | "unit";

function slugify(input: string): string {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function shortCode(label: string): string {
  const cleaned = String(label).trim().toUpperCase();
  if (cleaned.length <= 8 && !cleaned.includes(" ")) return cleaned;
  return cleaned
    .split(/\s+/)
    .map((w) => w.slice(0, 3))
    .join("-")
    .slice(0, 12);
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private modelFor(entity: CatalogEntity) {
    switch (entity) {
      case "category":
        return this.prisma.category;
      case "brand":
        return this.prisma.brand;
      case "grade":
        return this.prisma.grade;
      case "unit":
        return this.prisma.unit;
      default:
        throw new BadRequestException(`Unknown catalog entity: ${entity}`);
    }
  }

  async findAll(entity: CatalogEntity) {
    const model = this.modelFor(entity) as any;
    return model.findMany({ orderBy: { name: "asc" } });
  }

  async findOne(entity: CatalogEntity, id: string) {
    const model = this.modelFor(entity) as any;
    const row = await model.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`${entity} not found`);
    return row;
  }

  async create(entity: CatalogEntity, data: { name: string; code?: string; isActive?: boolean }, actorId: string) {
    const model = this.modelFor(entity) as any;
    const name = data.name.trim();
    if (!name) throw new BadRequestException("name is required");

    const payload: Record<string, unknown> = {
      name,
      isActive: data.isActive ?? true,
    };

    if (entity === "unit") {
      payload.code = (data.code || shortCode(name)).trim().toUpperCase();
    } else {
      payload.slug = slugify(name);
    }

    const created = await model.create({ data: payload });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `CATALOG_${entity.toUpperCase()}_CREATED`,
        entityType: entity,
        entityId: created.id,
        metadata: payload as any,
      },
    });

    return created;
  }

  async update(
    entity: CatalogEntity,
    id: string,
    data: { name?: string; code?: string; isActive?: boolean },
    actorId: string
  ) {
    const model = this.modelFor(entity) as any;
    const existing = await model.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`${entity} not found`);

    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) throw new BadRequestException("name cannot be empty");
      payload.name = name;
      if (entity !== "unit") payload.slug = slugify(name);
    }
    if (entity === "unit" && data.code !== undefined) {
      payload.code = data.code.trim().toUpperCase();
    }
    if (data.isActive !== undefined) payload.isActive = data.isActive;

    const updated = await model.update({ where: { id }, data: payload });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `CATALOG_${entity.toUpperCase()}_UPDATED`,
        entityType: entity,
        entityId: id,
        metadata: payload as any,
      },
    });

    return updated;
  }

  // Soft "delete" — deactivate rather than hard-delete, since Products may reference
  // these rows (Brand/Grade/Unit/Category are all nullable FKs on Product except
  // Category which is required, so category cannot be deactivated if in use... but we
  // still just flip isActive here; referential integrity for Category is enforced by
  // the required FK so a hard delete would fail naturally if in use).
  async deactivate(entity: CatalogEntity, id: string, actorId: string) {
    return this.update(entity, id, { isActive: false }, actorId);
  }
}
