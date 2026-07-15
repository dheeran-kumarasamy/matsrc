import { Injectable, Logger } from "@nestjs/common";
import Twilio from "twilio";
import { WhatsAppAlertConfigService } from "./whatsapp-alert-config.service";
import {
  WhatsAppAlertTemplateKey,
  WhatsAppProvider,
  WhatsAppSendTemplateParams,
  WhatsAppSendTemplateResult,
} from "./whatsapp-alert-provider.interface";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

/** Twilio error codes that represent permanent, non-retryable failures. */
const PERMANENT_ERROR_CODES = new Set<number>([
  21211, // Invalid 'To' Phone Number
  21614, // 'To' number is not a valid mobile number
  63016, // Failed to send freeform message because you are outside the allowed window (template required)
  63018, // Template message content mismatch / not approved
  21617, // Message body/media exceeds size limits
]);

/**
 * Twilio WhatsApp Business API implementation of `WhatsAppProvider`.
 *
 * Sends via WhatsApp Content Templates (never free-form text), since these are
 * business-initiated messages sent outside any customer-service session window.
 *
 * Never throws — every failure mode (transport error, Twilio API error, permanent
 * rejection) is captured in the returned `WhatsAppSendTemplateResult`. Retries with
 * exponential backoff on transient/5xx-class failures only; permanent failures (invalid
 * number, unapproved/unknown template) fail fast with no retry.
 */
@Injectable()
export class TwilioWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger(TwilioWhatsAppProvider.name);
  private client: ReturnType<typeof Twilio> | null = null;

  constructor(private readonly config: WhatsAppAlertConfigService) {}

  private getClient(): ReturnType<typeof Twilio> {
    if (this.client) {
      return this.client;
    }

    const accountSid = this.config.getTwilioAccountSid();
    const authToken = this.config.getTwilioAuthToken();

    if (!accountSid || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured");
    }

    this.client = Twilio(accountSid, authToken);
    return this.client;
  }

  async sendTemplateMessage(
    to: string,
    templateKey: WhatsAppAlertTemplateKey,
    params: WhatsAppSendTemplateParams
  ): Promise<WhatsAppSendTemplateResult> {
    try {
      const contentSid = this.config.getTwilioContentSid(templateKey);
      if (!contentSid) {
        const error = `No Twilio Content Template SID configured for templateKey "${templateKey}"`;
        this.logger.error(`[twilio-whatsapp] ${error}`);
        return { success: false, error };
      }

      const from = this.resolveFrom();
      if (!from.messagingServiceSid && !from.whatsappNumber) {
        const error = "Neither TWILIO_MESSAGING_SERVICE_SID nor TWILIO_WHATSAPP_NUMBER is configured";
        this.logger.error(`[twilio-whatsapp] ${error}`);
        return { success: false, error };
      }

      return await this.sendWithRetry(to, contentSid, params, from);
    } catch (error) {
      // Defensive catch-all: this method must never throw to callers.
      const message = error instanceof Error ? error.message : "Unknown error sending WhatsApp template message";
      this.logger.error(`[twilio-whatsapp] Unexpected error sending to ${to}: ${message}`);
      return { success: false, error: message };
    }
  }

  private resolveFrom(): { whatsappNumber?: string; messagingServiceSid?: string } {
    const messagingServiceSid = this.config.getTwilioMessagingServiceSid();
    if (messagingServiceSid) {
      return { messagingServiceSid };
    }

    const whatsappNumber = this.config.getTwilioWhatsAppNumber();
    return { whatsappNumber: whatsappNumber ? this.toWhatsAppAddress(whatsappNumber) : undefined };
  }

  private toWhatsAppAddress(rawNumber: string): string {
    return rawNumber.startsWith("whatsapp:") ? rawNumber : `whatsapp:${rawNumber}`;
  }

  private async sendWithRetry(
    to: string,
    contentSid: string,
    params: WhatsAppSendTemplateParams,
    from: { whatsappNumber?: string; messagingServiceSid?: string },
    attempt = 0
  ): Promise<WhatsAppSendTemplateResult> {
    try {
      const client = this.getClient();
      const message = await client.messages.create({
        to: this.toWhatsAppAddress(to),
        ...(from.messagingServiceSid ? { messagingServiceSid: from.messagingServiceSid } : { from: from.whatsappNumber! }),
        contentSid,
        contentVariables: JSON.stringify(params),
      });

      return { success: true, providerMessageId: message.sid };
    } catch (error: any) {
      const errorCode: number | undefined = typeof error?.code === "number" ? error.code : undefined;
      const status: number | undefined = typeof error?.status === "number" ? error.status : undefined;
      const isPermanent = errorCode !== undefined && PERMANENT_ERROR_CODES.has(errorCode);
      const isTransient = !isPermanent && (status === undefined || status >= 500 || status === 429);

      if (isTransient && attempt < MAX_RETRIES) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        this.logger.warn(
          `[twilio-whatsapp] Send to ${to} failed (status=${status ?? "n/a"}, code=${errorCode ?? "n/a"}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await this.sleep(delayMs);
        return this.sendWithRetry(to, contentSid, params, from, attempt + 1);
      }

      const message = error instanceof Error ? error.message : "WhatsApp send failed";
      this.logger.error(
        `[twilio-whatsapp] Send to ${to} failed permanently: status=${status ?? "n/a"} code=${errorCode ?? "n/a"} message=${message}`
      );
      return { success: false, error: `${message}${errorCode ? ` (code=${errorCode})` : ""}` };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
