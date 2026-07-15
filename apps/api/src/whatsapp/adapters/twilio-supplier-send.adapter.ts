import { Injectable, Logger } from "@nestjs/common";
import Twilio from "twilio";
import { BotMessage, BotTemplateComponent } from "../whatsapp.types";
import { WhatsAppSendAdapter, WhatsAppSendResult } from "./whatsapp-send.interface";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

/** Twilio error codes that represent permanent, non-retryable failures (mirrors twilio-whatsapp.provider.ts). */
const PERMANENT_ERROR_CODES = new Set<number>([
  21211, // Invalid 'To' Phone Number
  21614, // 'To' number is not a valid mobile number
  63016, // Freeform message outside the allowed session window (template required)
  63018, // Template message content mismatch / not approved
  21617, // Message body/media exceeds size limits
]);

/**
 * Twilio WhatsApp Business API send adapter for the Supplier bot — an alternative to
 * `MetaCloudApiSendAdapter`, selected via `WHATSAPP_ADAPTER=twilio`.
 *
 * Implements the same `WhatsAppSendAdapter` interface — no other module code
 * (router/flows/session/auth) needs to change to swap between `mock` / `meta` / `twilio`.
 *
 * Uses a DEDICATED set of `TWILIO_SUPPLIER_*` env vars, intentionally separate from the
 * `TWILIO_*` vars used by `notifications/whatsapp-alerts` (a different feature, sending
 * to builders, not suppliers) — the two features can use different Twilio senders/
 * numbers/webhooks even under the same Twilio account. `TWILIO_ACCOUNT_SID`/
 * `TWILIO_AUTH_TOKEN` (account-level credentials) are shared between both features.
 *
 * Design note — Twilio WhatsApp has no native "interactive list" / "reply buttons"
 * message type (Meta's Cloud API does). `BotMessage`'s `list`/`buttons` kinds are
 * flattened into numbered plain-text options here; suppliers reply with the option
 * number (already supported by `WhatsAppRouterService`/flow `fuzzyMatch`, which accepts
 * row ids OR free text).
 */
@Injectable()
export class TwilioSupplierSendAdapter implements WhatsAppSendAdapter {
  private readonly logger = new Logger(TwilioSupplierSendAdapter.name);
  private client: ReturnType<typeof Twilio> | null = null;

  private getClient(): ReturnType<typeof Twilio> {
    if (this.client) return this.client;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured");
    }

    this.client = Twilio(accountSid, authToken);
    return this.client;
  }

  private resolveFrom(): { whatsappNumber?: string; messagingServiceSid?: string } {
    const messagingServiceSid = process.env.TWILIO_SUPPLIER_MESSAGING_SERVICE_SID;
    if (messagingServiceSid) return { messagingServiceSid };

    const whatsappNumber = process.env.TWILIO_SUPPLIER_WHATSAPP_NUMBER;
    return { whatsappNumber: whatsappNumber ? this.toWhatsAppAddress(whatsappNumber) : undefined };
  }

  private toWhatsAppAddress(rawNumber: string): string {
    return rawNumber.startsWith("whatsapp:") ? rawNumber : `whatsapp:${rawNumber}`;
  }

  /** Looks up a Content Template SID for a given template `name`, if one is mapped. */
  private getContentSid(templateName: string): string | undefined {
    if (templateName === "supplier_otp_verification") {
      return process.env.TWILIO_CONTENT_SID_SUPPLIER_OTP_VERIFICATION;
    }
    if (templateName === process.env.WHATSAPP_REENGAGEMENT_TEMPLATE) {
      return process.env.TWILIO_CONTENT_SID_SUPPLIER_REENGAGEMENT;
    }
    return undefined;
  }

  async send(to: string, message: BotMessage): Promise<WhatsAppSendResult> {
    const from = this.resolveFrom();
    if (!from.messagingServiceSid && !from.whatsappNumber) {
      throw new Error("Neither TWILIO_SUPPLIER_MESSAGING_SERVICE_SID nor TWILIO_SUPPLIER_WHATSAPP_NUMBER is configured");
    }

    if (message.kind === "template") {
      const contentSid = this.getContentSid(message.name);
      if (contentSid) {
        return this.sendWithRetry(to, from, {
          contentSid,
          contentVariables: JSON.stringify(this.componentsToVariables(message.components ?? [])),
        });
      }
      // No approved Content Template SID mapped (e.g. running in Twilio Sandbox, which
      // cannot use custom-approved templates) — fall back to a readable free-form body
      // so the flow (in particular OTP delivery) is still testable end-to-end.
      this.logger.warn(
        `[twilio-supplier-whatsapp] No Content Template SID configured for template "${message.name}" — sending free-form text instead.`
      );
      return this.sendWithRetry(to, from, { body: this.templateToFreeformBody(message.name, message.components ?? []) });
    }

    const body = this.toFreeformBody(message);
    return this.sendWithRetry(to, from, { body });
  }

  private componentsToVariables(components: BotTemplateComponent[]): Record<string, string> {
    const variables: Record<string, string> = {};
    let index = 1;
    for (const component of components) {
      for (const parameter of component.parameters) {
        if (parameter.type === "text") {
          variables[String(index)] = parameter.text;
          index += 1;
        }
      }
    }
    return variables;
  }

  private templateToFreeformBody(name: string, components: BotTemplateComponent[]): string {
    const values = components
      .flatMap((component) => component.parameters)
      .map((parameter) => (parameter.type === "text" ? parameter.text : parameter.payload))
      .join(" ");
    return `[${name}] ${values}`.trim();
  }

  private toFreeformBody(message: Exclude<BotMessage, { kind: "template" }>): string {
    switch (message.kind) {
      case "text":
        return message.text;

      case "list": {
        const lines = message.rows.map((row, i) => `${i + 1}. ${row.title}${row.description ? ` — ${row.description}` : ""}`);
        const header = message.header ? `*${message.header}*\n` : "";
        return `${header}${message.body}\n\n${lines.join("\n")}\n\nReply with the number of your choice.`;
      }

      case "buttons": {
        const lines = message.buttons.map((button, i) => `${i + 1}. ${button.title}`);
        return `${message.body}\n\n${lines.join("\n")}\n\nReply with the number of your choice.`;
      }

      default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unsupported BotMessage kind: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private async sendWithRetry(
    to: string,
    from: { whatsappNumber?: string; messagingServiceSid?: string },
    payload: { body?: string; contentSid?: string; contentVariables?: string },
    attempt = 0
  ): Promise<WhatsAppSendResult> {
    try {
      const client = this.getClient();
      const message = await client.messages.create({
        to: this.toWhatsAppAddress(to),
        ...(from.messagingServiceSid ? { messagingServiceSid: from.messagingServiceSid } : { from: from.whatsappNumber! }),
        ...payload,
      });

      return { externalId: message.sid, provider: "twilio-supplier-whatsapp" };
    } catch (error: any) {
      const errorCode: number | undefined = typeof error?.code === "number" ? error.code : undefined;
      const status: number | undefined = typeof error?.status === "number" ? error.status : undefined;
      const isPermanent = errorCode !== undefined && PERMANENT_ERROR_CODES.has(errorCode);
      const isTransient = !isPermanent && (status === undefined || status >= 500 || status === 429);

      if (isTransient && attempt < MAX_RETRIES) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        this.logger.warn(
          `[twilio-supplier-whatsapp] Send to ${to} failed (status=${status ?? "n/a"}, code=${errorCode ?? "n/a"}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await this.sleep(delayMs);
        return this.sendWithRetry(to, from, payload, attempt + 1);
      }

      const message = error instanceof Error ? error.message : "WhatsApp send failed";
      this.logger.error(
        `[twilio-supplier-whatsapp] Send to ${to} failed permanently: status=${status ?? "n/a"} code=${errorCode ?? "n/a"} message=${message}`
      );
      throw new Error(`Twilio WhatsApp send failed: ${message}${errorCode ? ` (code=${errorCode})` : ""}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
