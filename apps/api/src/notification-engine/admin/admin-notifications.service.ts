import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { WhatsAppEngineConfigService } from "../whatsapp/whatsapp-engine-config.service";
import { UpdateGlobalWhatsAppSettingsDto, UpdateNotificationPolicyDto } from "./dto/update-notification-policy.dto";

/**
 * Backs the Admin `/admin/notifications` page (spec Phase 8/9). Every
 * mutation writes a `NotificationPolicyAudit` row — who changed what, when,
 * old value -> new value, and an optional reason — mirroring the existing
 * `AuditLog`-based audit pattern used elsewhere in Admin, but scoped to its
 * own table since the spec explicitly calls for a policy-specific audit
 * model (`NotificationPolicyAudit`).
 */
@Injectable()
export class AdminNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppConfig: WhatsAppEngineConfigService
  ) {}

  async listPolicies() {
    return this.prisma.notificationEventPolicy.findMany({ orderBy: [{ channel: "asc" }, { eventType: "asc" }] });
  }

  async getGlobalSettings() {
    const settings = await this.prisma.notificationGlobalSettings.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global" },
    });
    return { ...settings, whatsappMode: this.whatsAppConfig.getMode() };
  }

  async updatePolicy(id: string, dto: UpdateNotificationPolicyDto, actorId: string) {
    const existing = await this.prisma.notificationEventPolicy.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Notification policy not found");
    }

    const data: Record<string, unknown> = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.maxPerDay !== undefined) data.maxPerDay = dto.maxPerDay;
    if (dto.cooldownMinutes !== undefined) data.cooldownMinutes = dto.cooldownMinutes;
    if (dto.businessHoursOnly !== undefined) data.businessHoursOnly = dto.businessHoursOnly;

    const updated = await this.prisma.notificationEventPolicy.update({ where: { id }, data });

    await this.prisma.notificationPolicyAudit.create({
      data: {
        policyId: id,
        action: "UPDATE_POLICY",
        oldValue: existing as any,
        newValue: updated as any,
        reason: dto.reason ?? null,
        changedBy: actorId,
      },
    });

    return updated;
  }

  async updateGlobalWhatsAppSettings(dto: UpdateGlobalWhatsAppSettingsDto, actorId: string) {
    const existing = await this.prisma.notificationGlobalSettings.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global" },
    });

    const updated = await this.prisma.notificationGlobalSettings.update({
      where: { id: "global" },
      data: { whatsappBusinessEnabled: dto.whatsappBusinessEnabled, updatedBy: actorId },
    });

    await this.prisma.notificationPolicyAudit.create({
      data: {
        policyId: "global",
        action: dto.whatsappBusinessEnabled ? "GLOBAL_WHATSAPP_ENABLED" : "GLOBAL_WHATSAPP_DISABLED",
        oldValue: { whatsappBusinessEnabled: existing.whatsappBusinessEnabled } as any,
        newValue: { whatsappBusinessEnabled: updated.whatsappBusinessEnabled } as any,
        reason: dto.reason ?? null,
        changedBy: actorId,
      },
    });

    return { ...updated, whatsappMode: this.whatsAppConfig.getMode() };
  }

  async listAudits(policyId?: string, limit = 100) {
    return this.prisma.notificationPolicyAudit.findMany({
      where: policyId ? { policyId } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }
}
