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
      const mode = this.config.getMode();

      const from = this.resolveFrom();
      if (!from.messagingServiceSid && !from.whatsappNumber) {
        const error = "Neither TWILIO_MESSAGING_SERVICE_SID nor TWILIO_WHATSAPP_NUMBER is configured";
        this.logger.error(`[twilio-whatsapp] ${error}`);
        return { success: false, error };
      }

      if (!contentSid) {
        if (mode === "sandbox") {
          // Twilio's WhatsApp Sandbox does not support custom-approved Content
          // Templates — only free-form replies within the 24-hour session window are
          // available. Rather than hard-failing (as production does), fall back to a
          // plain-text send so sandbox testing can proceed. This branch is intentionally
          // sandbox-only: production never silently substitutes free text for a missing
          // template (see the `else` branch below).
          this.logger.warn(
            `[twilio-whatsapp][sandbox-fallback] No Content Template SID configured for templateKey "${templateKey}" ` +
              `while WHATSAPP_MODE=sandbox — sending a free-form text message instead of a template.`
          );
          return await this.sendFreeformWithRetry(to, this.buildFreeformBody(templateKey, params), from);
        }

        // Production: never silently fall back to free-form text. Fail loudly (critical
        // log) and return a structured failure.
        const error = `No Twilio Content Template SID configured for templateKey "${templateKey}"`;
        this.logger.error(`[twilio-whatsapp][CRITICAL] WHATSAPP_MODE=production: ${error}. Refusing to send free-form fallback.`);
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

  /** Builds a readable free-form fallback message body for sandbox mode from the raw template params. */
  private buildFreeformBody(templateKey: WhatsAppAlertTemplateKey, params: WhatsAppSendTemplateParams): string {
    const fields = Object.entries(params)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    return `[${templateKey}]\n${fields}`;
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

  /**
   * Sandbox-only free-form-text send path (no `contentSid`/`contentVariables`), used
   * when `sendTemplateMessage` falls back because no Content Template SID is mapped for
   * the given `templateKey` while `WHATSAPP_MODE=sandbox`. Mirrors `sendWithRetry`'s
   * retry/backoff/permanent-vs-transient handling exactly, just with a different Twilio
   * `messages.create` payload shape.
   */
  private async sendFreeformWithRetry(
    to: string,
    body: string,
    from: { whatsappNumber?: string; messagingServiceSid?: string },
    attempt = 0
  ): Promise<WhatsAppSendTemplateResult> {
    try {
      const client = this.getClient();
      const message = await client.messages.create({
        to: this.toWhatsAppAddress(to),
        ...(from.messagingServiceSid ? { messagingServiceSid: from.messagingServiceSid } : { from: from.whatsappNumber! }),
        body,
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
          `[twilio-whatsapp][sandbox-fallback] Freeform send to ${to} failed (status=${status ?? "n/a"}, code=${errorCode ?? "n/a"}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await this.sleep(delayMs);
        return this.sendFreeformWithRetry(to, body, from, attempt + 1);
      }

      const message = error instanceof Error ? error.message : "WhatsApp freeform send failed";
      this.logger.error(
        `[twilio-whatsapp][sandbox-fallback] Freeform send to ${to} failed permanently: status=${status ?? "n/a"} code=${errorCode ?? "n/a"} message=${message}`
      );
      return { success: false, error: `${message}${errorCode ? ` (code=${errorCode})` : ""}` };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

