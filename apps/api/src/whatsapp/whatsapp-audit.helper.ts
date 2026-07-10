import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

/**
 * Writes every WhatsApp-originated mutation to the same `AuditLog` table used by the
 * Supplier/Admin portals, tagged `channel: "whatsapp"` in metadata so Admin's audit feed
 * remains a single source of truth (per spec §8 Audit trail).
 */
@Injectable()
export class WhatsAppAuditHelper {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: { ...(params.metadata ?? {}), channel: "whatsapp" },
      },
    });
  }

  /**
   * Records a Meta delivery-status webhook event (sent/delivered/read/failed) for an
   * outbound message we previously sent, so delivery outcomes — not just outbound intent
   * — show up in Admin's audit feed. `actorId` is best-effort (the recipient's userId if
   * we can resolve it from the phone number at the call site; otherwise "system").
   */
  async recordDeliveryStatus(params: {
    actorId: string;
    messageId: string;
    status: string;
    recipientPhone: string;
    timestamp?: string;
    errors?: unknown;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: "WHATSAPP_DELIVERY_STATUS",
        entityType: "WhatsAppMessage",
        entityId: params.messageId,
        metadata: {
          channel: "whatsapp",
          status: params.status,
          recipientPhone: params.recipientPhone,
          timestamp: params.timestamp ?? null,
          errors: params.errors ?? null,
        },
      },
    });
  }

  /**
   * Records an AGENT/HELP human-handoff escalation so ops staff can see it from the
   * existing Admin portal (surfaced via the `admin/whatsapp-escalations` endpoint, which
   * reads `AuditLog` rows tagged with this action — reusing the same access-control
   * pattern as `admin/disputes` without introducing a new Prisma model/migration).
   */
  async recordEscalation(params: {
    actorId: string;
    phone: string;
    lastMessage?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: "WHATSAPP_ESCALATION",
        entityType: "WhatsAppSession",
        entityId: params.phone,
        metadata: {
          channel: "whatsapp",
          phone: params.phone,
          lastMessage: params.lastMessage ?? null,
        },
      },
    });
  }
}

