import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

export type AuditLogEntry = {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
};

export type AuditFilters = {
  limit?: number;
  category?: string;
  actorId?: string;
  action?: string;
  entityId?: string;
  from?: string;
  to?: string;
};

// Maps the spec's filter categories to entityType prefixes/values used across the AuditLog table.
const CATEGORY_ENTITY_TYPE_MAP: Record<string, string[]> = {
  Pricing: [
    "PricingCanonicalSku",
    "PricingSkuAlias",
    "PricingSource",
    "PricingSourceEndpoint",
    "PricingObservation",
    "PricingAnomaly",
    "PricingDistrictPriceDaily",
  ],
  Sources: ["PricingSource"],
  Endpoints: ["PricingSourceEndpoint"],
  Rollups: ["PricingDistrictPriceDaily", "PricingRollup"],
  Mappings: ["PricingCanonicalSku", "PricingSkuAlias"],
  Anomalies: ["PricingAnomaly"],
  Compliance: ["PricingSource"],
  Users: ["User"],
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(filters: AuditFilters) {
    const where: Record<string, unknown> = {};

    if (filters.category && CATEGORY_ENTITY_TYPE_MAP[filters.category]) {
      where.entityType = { in: CATEGORY_ENTITY_TYPE_MAP[filters.category] };
    }
    if (filters.actorId) {
      where.actorId = { contains: filters.actorId, mode: "insensitive" };
    }
    if (filters.action) {
      where.action = { contains: filters.action, mode: "insensitive" };
    }
    if (filters.entityId) {
      where.entityId = filters.entityId;
    }
    if (filters.from || filters.to) {
      const createdAt: Record<string, Date> = {};
      if (filters.from) createdAt.gte = new Date(filters.from);
      if (filters.to) createdAt.lte = new Date(filters.to);
      where.createdAt = createdAt;
    }

    return where;
  }

  async findRecent(filters: AuditFilters = {}): Promise<AuditLogEntry[]> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
    const where = this.buildWhere(filters);

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return logs.map((log) => ({
      id: log.id,
      actorId: log.actorId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      createdAt: log.createdAt,
    }));
  }
}
