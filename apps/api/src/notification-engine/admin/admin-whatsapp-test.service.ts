import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { WhatsAppEngineConfigService } from "../whatsapp/whatsapp-engine-config.service";
import { WhatsappNotificationService } from "../whatsapp/whatsapp-notification.service";

/**
 * Backs the Admin `/admin/whatsapp-alerts` test page (spec Phase 10) —
 * separate from `/admin/notifications` (business policy management).
 * Reuses `WhatsappNotificationService` directly (bypassing
 * NotificationPolicyService) since this is an explicit admin-initiated
 * *test* send, not a business event — the operator has already decided to
 * send it; there is no event/policy/dedupe context to gate against.
 */
@Injectable()
export class AdminWhatsAppTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappNotificationService,
    private readonly config: WhatsAppEngineConfigService
  ) {}

  getMode(): string {
    return this.config.getMode();
  }

  async sendTestAlert(phone: string, templateName: string, parameters: string[]) {
    return this.whatsapp.sendTemplateAlert(phone, templateName, parameters);
  }

  async listRecentLogs(limit = 50) {
    return this.prisma.whatsAppMessageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }
}
