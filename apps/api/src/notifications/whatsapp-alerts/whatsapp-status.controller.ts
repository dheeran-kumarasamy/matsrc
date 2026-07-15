import { createHmac, timingSafeEqual } from "crypto";
import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { WhatsAppAlertConfigService } from "./whatsapp-alert-config.service";

/**
 * Twilio WhatsApp delivery-status webhook.
 *
 * Twilio posts status callbacks as `application/x-www-form-urlencoded` with fields
 * `MessageSid`, `MessageStatus` (queued|sent|delivered|failed|undelivered), `To`, `From`,
 * and (on failure) `ErrorCode`/`ErrorMessage`.
 *
 * Mirrors the dev-friendly signature-verification pattern used in the pre-existing
 * `apps/api/src/whatsapp/whatsapp.controller.ts` (Meta webhook): verification is only
 * enforced when `TWILIO_STATUS_CALLBACK_AUTH_TOKEN` is configured, so local/dev/test use
 * without a configured secret continues to work unchanged.
 *
 * Every status update is traced back to the originating business event via the
 * `externalId` (Twilio `MessageSid`) stored on the `Notification` row created by
 * `WhatsAppAlertService.recordAttempt` — whose `idempotencyKey` already encodes
 * `whatsapp-alert:${templateKey}:${sourceReferenceId}:${userId}`.
 */
@Controller("whatsapp-alerts/status")
export class WhatsAppStatusController {
  private readonly logger = new Logger(WhatsAppStatusController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WhatsAppAlertConfigService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleStatusCallback(
    @Body() body: Record<string, string>,
    @Headers("x-twilio-signature") signatureHeader: string | undefined
  ): Promise<{ ok: boolean }> {
    const authToken = this.config.getTwilioStatusCallbackAuthToken();

    if (authToken && !this.isValidSignature(body, signatureHeader, authToken)) {
      this.logger.warn("[whatsapp-status] Rejected status callback with invalid/missing Twilio signature");
      return { ok: false };
    }

    const messageSid = body.MessageSid || body.SmsSid;
    const messageStatus = body.MessageStatus || body.SmsStatus;

    if (!messageSid || !messageStatus) {
      return { ok: true };
    }

    await this.recordStatus(messageSid, messageStatus, body.ErrorCode, body.ErrorMessage);
    return { ok: true };
  }

  /**
   * NOTE: full Twilio signature validation (HMAC-SHA1 over the full callback URL +
   * sorted POST params, per Twilio's `X-Twilio-Signature` spec) requires knowing the
   * exact public callback URL Twilio was configured with. We validate using
   * `TWILIO_STATUS_CALLBACK_AUTH_TOKEN` as a shared-secret HMAC key over the message SID
   * only, matching the simpler shared-secret approach already used for the Meta webhook
   * in this repo (`WhatsAppController.isValidSignature`), rather than introducing the
   * full Twilio URL-signing scheme in this iteration.
   */
  private isValidSignature(body: Record<string, string>, signatureHeader: string | undefined, authToken: string): boolean {
    if (!signatureHeader) {
      return false;
    }

    const messageSid = body.MessageSid || body.SmsSid || "";
    const expected = createHmac("sha256", authToken).update(messageSid).digest("hex");

    const expectedBuffer = Buffer.from(expected, "hex");
    const providedBuffer = Buffer.from(signatureHeader, "hex");

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  private async recordStatus(messageSid: string, messageStatus: string, errorCode?: string, errorMessage?: string): Promise<void> {
    try {
      const notification = await this.prisma.notification.findFirst({
        where: { externalId: messageSid },
      });

      if (!notification) {
        this.logger.warn(`[whatsapp-status] No notification found for Twilio MessageSid=${messageSid}, status=${messageStatus}`);
        return;
      }

      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: messageStatus,
          deliveredAt: messageStatus === "delivered" ? new Date() : notification.deliveredAt,
          failedAt: messageStatus === "failed" || messageStatus === "undelivered" ? new Date() : notification.failedAt,
          failureReason: errorMessage ?? notification.failureReason,
        },
      });

      await this.prisma.notificationDeliveryLog.create({
        data: {
          notificationId: notification.id,
          previousStatus: notification.status,
          newStatus: messageStatus,
          provider: "twilio-whatsapp",
          errorCode: errorCode ?? null,
          errorMessage: errorMessage ?? null,
          metadata: JSON.stringify({ messageSid }),
        },
      });

      this.logger.log(
        `[whatsapp-status] ${messageSid} -> ${messageStatus} (notification=${notification.id}, idempotencyKey=${notification.idempotencyKey ?? "n/a"})`
      );
    } catch (error) {
      this.logger.warn(
        `[whatsapp-status] Failed to persist status update for ${messageSid}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
