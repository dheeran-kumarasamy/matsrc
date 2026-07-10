import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

/**
 * Surfaces AGENT/HELP WhatsApp bot human-handoff escalations for ops staff, reusing the
 * existing `AuditLog` table (rows written by `WhatsAppAuditHelper.recordEscalation`,
 * tagged `action: "WHATSAPP_ESCALATION"`) rather than introducing a new Prisma model —
 * mirrors the read pattern in `admin/audit`.
 */
@Injectable()
export class WhatsAppEscalationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findRecent(
    limit: number = 50
  ): Promise<
    Array<{
      id: string;
      actorId: string;
      phone: string | null;
      lastMessage: string | null;
      createdAt: Date;
    }>
  > {
    const logs = await this.prisma.auditLog.findMany({
      where: { action: "WHATSAPP_ESCALATION" },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return logs.map((log) => {
      const metadata = (log.metadata as Record<string, unknown> | null) ?? {};
      return {
        id: log.id,
        actorId: log.actorId,
        phone: typeof metadata.phone === "string" ? metadata.phone : null,
        lastMessage: typeof metadata.lastMessage === "string" ? metadata.lastMessage : null,
        createdAt: log.createdAt,
      };
    });
  }
}
