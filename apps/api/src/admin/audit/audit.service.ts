import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async findRecent(
    limit: number = 50
  ): Promise<
    Array<{
      id: string;
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      metadata: unknown;
      createdAt: Date;
    }>
  > {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
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
