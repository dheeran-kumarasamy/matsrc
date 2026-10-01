import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { WhatsAppAlertConfigService } from "./whatsapp-alert-config.service";
import {
  WHATSAPP_ALERT_PROVIDER,
  WhatsAppAlertTemplateKey,
  WhatsAppProvider,
  WhatsAppSendTemplateParams,
} from "./whatsapp-alert-provider.interface";

/**
 * Orchestrates outbound WhatsApp business alerts for the three hooks in scope
 * (order-status-change, watchlist price-alert, RFQ-quote-received).
 *
 * This is the ONLY entry point business-logic call sites should use — it is responsible
 * for the feature-flag gate, the per-user opt-in gate, and turning any provider failure
 * into a log line rather than a thrown error, so callers can fire-and-forget without
 * ever affecting the underlying order/watchlist/RFQ operation.
 *
 * Deliberately independent of the existing `NotificationService` (mock WhatsApp /
 * BullMQ) — additive alongside it, never a replacement of any existing channel.
 */
@Injectable()
export class WhatsAppAlertService {
  private readonly logger = new Logger(WhatsAppAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WhatsAppAlertConfigService,
    @Inject(WHATSAPP_ALERT_PROVIDER) private readonly provider: WhatsAppProvider
  ) {}

  // sendOrderStatusUpdate() was removed — the customer-facing order-status
  // WhatsApp notification is now sent exclusively via the Meta WhatsApp
  // Cloud API / Notification Engine ("customer_order_status" template, see
  // apps/api/src/notification-engine/whatsapp/customer-order-status-notification.service.ts),
  // not this Twilio-based alert channel. This service remains in active use
  // for the two methods below.

  async sendWatchlistPriceHit(params: {
    userId: string;
    productId: string;
    productName: string;
    currentPrice: string;
    targetPrice: string;
  }): Promise<void> {
    await this.sendGated("watchlist_price_hit", params.userId, params.productId, {
      productName: params.productName,
      currentPrice: params.currentPrice,
      targetPrice: params.targetPrice,
    });
  }

  async sendRfqQuoteReceived(params: {
    userId: string;
    enquiryId: string;
    supplierName?: string | null;
    bestPriceTotal?: string;
  }): Promise<void> {
    await this.sendGated("rfq_quote_received", params.userId, params.enquiryId, {
      enquiryId: params.enquiryId,
      supplierName: params.supplierName ?? "",
      bestPriceTotal: params.bestPriceTotal ?? "",
    });
  }

  /**
   * Shared gate + send + log-traceable-delivery-record path for all three alert types.
   *
   * `sourceReferenceId` is the internal order/product/enquiry ID the alert was triggered
   * by — persisted alongside the provider's `providerMessageId` so a delivery-status
   * webhook callback (see `whatsapp-status.controller.ts`) can always be traced back to
   * the business event that caused the send.
   */
  private async sendGated(
    templateKey: WhatsAppAlertTemplateKey,
    userId: string,
    sourceReferenceId: string,
    params: WhatsAppSendTemplateParams
  ): Promise<void> {
    try {
      if (!this.config.isEnabled()) {
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { notificationPreference: true },
      });

      if (!user) {
        return;
      }

      const optedIn = user.notificationPreference?.whatsappOptIn === true;

      if (!optedIn) {
        return;
      }

      const to = user.whatsappNumber?.trim() || user.phone?.trim();
      if (!to) {
        this.logger.warn(`[whatsapp-alert] No WhatsApp/phone number for user ${userId}, skipping ${templateKey} alert`);
        return;
      }

      const result = await this.provider.sendTemplateMessage(to, templateKey, params);

      if (result.success) {
        this.logger.log(
          `[whatsapp-alert] Sent ${templateKey} to user=${userId} ref=${sourceReferenceId} providerMessageId=${result.providerMessageId ?? "n/a"}`
        );
      } else {
        this.logger.warn(
          `[whatsapp-alert] Failed to send ${templateKey} to user=${userId} ref=${sourceReferenceId}: ${result.error ?? "unknown error"}`
        );
      }

      await this.recordAttempt(templateKey, sourceReferenceId, userId, result.success, result.providerMessageId, result.error);
    } catch (error) {
      // Belt-and-braces: a WhatsApp send failure (of any kind, including our own bugs)
      // must never propagate to the caller and affect the underlying business operation.
      const message = error instanceof Error ? error.message : "Unknown WhatsApp alert error";
      this.logger.warn(`[whatsapp-alert] Unexpected error sending ${templateKey} for ref=${sourceReferenceId}: ${message}`);
    }
  }

  private async recordAttempt(
    templateKey: WhatsAppAlertTemplateKey,
    sourceReferenceId: string,
    userId: string,
    success: boolean,
    providerMessageId: string | undefined,
    error: string | undefined
  ): Promise<void> {
    try {
      await this.prisma.notificationDeliveryLog.create({
        data: {
          notification: {
            connectOrCreate: {
              where: { idempotencyKey: `whatsapp-alert:${templateKey}:${sourceReferenceId}:${userId}` },
              create: {
                userId,
                channel: "WHATSAPP" as any,
                title: templateKey,
                body: `WhatsApp alert (${templateKey}) for ${sourceReferenceId}`,
                status: success ? "sent" : "failed",
                idempotencyKey: `whatsapp-alert:${templateKey}:${sourceReferenceId}:${userId}`,
                externalId: providerMessageId ?? null,
                failureReason: error ?? null,
              },
            },
          },
          previousStatus: null,
          newStatus: success ? "sent" : "failed",
          provider: "twilio-whatsapp",
          errorMessage: error ?? null,
          metadata: JSON.stringify({ templateKey, sourceReferenceId, providerMessageId }),
        },
      });
    } catch (error) {
      // Best-effort audit trail only — never let logging failures affect delivery flow.
      this.logger.warn(
        `[whatsapp-alert] Failed to persist delivery log for ${templateKey}/${sourceReferenceId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
