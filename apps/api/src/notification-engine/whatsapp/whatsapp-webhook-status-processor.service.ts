import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

/**
 * Processes Meta WhatsApp Cloud API delivery-status webhook events
 * (`body.entry[0].changes[0].value.statuses`) against `WhatsAppMessageLog`
 * (spec Phase 7). Deliberately additive alongside the existing
 * `WhatsAppAuditHelper.recordDeliveryStatus` (AuditLog-backed audit trail
 * for the Supplier bot) — this updates the Notification Engine's own
 * `WhatsAppMessageLog` rows (created by `WhatsappNotificationService`),
 * which the pre-existing AuditLog-based helper has no knowledge of.
 *
 * Never throrws — an unknown/unmatched `metaMessageId` is logged and
 * skipped, never treated as a webhook failure (Meta must always get its
 * 200 ack — enforced by the caller, `WhatsAppController`).
 */
@Injectable()
export class WhatsAppWebhookStatusProcessorService {
  private readonly logger = new Logger(WhatsAppWebhookStatusProcessorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processStatuses(
    statuses: Array<{ id: string; status: string; errors?: unknown }>
  ): Promise<void> {
    for (const status of statuses) {
      try {
        await this.processOne(status);
      } catch (error) {
        this.logger.warn(
          `Failed to process status for metaMessageId=${status.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private async processOne(status: { id: string; status: string; errors?: unknown }): Promise<void> {
    const log = await this.prisma.whatsAppMessageLog.findUnique({ where: { metaMessageId: status.id } });

    if (!log) {
      // Not every inbound status necessarily corresponds to a
      // NotificationEngine-originated send (e.g. the Supplier bot's own
      // sends, or a status delivered after log retention). This is
      // expected and must never fail the webhook.
      this.logger.debug(`No WhatsAppMessageLog found for metaMessageId=${status.id}, status=${status.status}`);
      return;
    }

    const normalizedStatus = this.normalizeStatus(status.status);
    const errorDetails = status.errors ? JSON.stringify(status.errors).slice(0, 2000) : undefined;

    await this.prisma.whatsAppMessageLog.update({
      where: { id: log.id },
      data: {
        status: normalizedStatus,
        ...(errorDetails ? { errorDetails } : {}),
      },
    });
  }

  private normalizeStatus(status: string): string {
    if (["sent", "delivered", "read", "failed"].includes(status)) {
      return status;
    }
    return status;
  }
}
