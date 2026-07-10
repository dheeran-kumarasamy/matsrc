import { Injectable, Logger } from "@nestjs/common";
import { BotMessage } from "../whatsapp.types";
import { WhatsAppSendAdapter, WhatsAppSendResult } from "./whatsapp-send.interface";

const GRAPH_API_VERSION = "v20.0";

/** Meta error code: the 24h customer-service window has closed (re-engagement required). */
const ERROR_CODE_REENGAGEMENT_WINDOW_EXPIRED = 131047;
/** Meta error code: message pacing / rate limit hit — back off and retry. */
const ERROR_CODE_PACING_RATE_LIMIT = 131056;

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

type MetaGraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

/**
 * Real WhatsApp Cloud API (Meta Graph API) send adapter.
 *
 * Implements the same `WhatsAppSendAdapter` interface as `MockWhatsAppSendAdapter` — no
 * other module code (router/flows/session/auth) needs to change. Selected via
 * `WHATSAPP_ADAPTER=meta` in `whatsapp.module.ts`.
 *
 * Handles:
 *  - text / interactive list / interactive reply buttons / template message shapes.
 *  - retry-with-backoff on 429 and 5xx transport-level failures.
 *  - Meta error code 131047 (re-engagement window expired) — falls back to a generic
 *    template message instead of the originally requested free-form message.
 *  - Meta error code 131056 (pacing/rate limit) — retried after a longer delay rather
 *    than failing hard.
 */
@Injectable()
export class MetaCloudApiSendAdapter implements WhatsAppSendAdapter {
  private readonly logger = new Logger(MetaCloudApiSendAdapter.name);

  private get phoneNumberId(): string {
    const value = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!value) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
    return value;
  }

  private get accessToken(): string {
    const value = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!value) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
    return value;
  }

  private get endpoint(): string {
    return `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.phoneNumberId}/messages`;
  }

  /** Name of the fallback re-engagement template used when the 24h window has closed. */
  private get reengagementTemplateName(): string {
    return process.env.WHATSAPP_REENGAGEMENT_TEMPLATE ?? "supplier_reengagement_nudge";
  }

  async send(to: string, message: BotMessage): Promise<WhatsAppSendResult> {
    const payload = this.toGraphPayload(to, message);
    return this.sendWithRetry(to, payload, message);
  }

  private async sendWithRetry(
    to: string,
    payload: Record<string, unknown>,
    originalMessage: BotMessage,
    attempt = 0
  ): Promise<WhatsAppSendResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const body = (await response.json()) as { messages?: Array<{ id: string }> };
      const externalId = body.messages?.[0]?.id ?? "";
      return { externalId, provider: "meta-whatsapp-cloud-api" };
    }

    const errorBody = (await response.json().catch(() => ({}))) as MetaGraphErrorBody;
    const errorCode = errorBody.error?.code;

    if (errorCode === ERROR_CODE_REENGAGEMENT_WINDOW_EXPIRED && originalMessage.kind !== "template") {
      this.logger.warn(
        `[meta-whatsapp] Re-engagement window expired for ${to} — falling back to template "${this.reengagementTemplateName}"`
      );
      const fallbackPayload = this.toGraphPayload(to, {
        kind: "template",
        name: this.reengagementTemplateName,
        languageCode: "en",
      });
      return this.sendWithRetry(to, fallbackPayload, { kind: "template", name: this.reengagementTemplateName, languageCode: "en" }, 0);
    }

    const shouldRetry =
      attempt < MAX_RETRIES &&
      (response.status === 429 || response.status >= 500 || errorCode === ERROR_CODE_PACING_RATE_LIMIT);

    if (shouldRetry) {
      const delayMs =
        errorCode === ERROR_CODE_PACING_RATE_LIMIT
          ? BASE_BACKOFF_MS * Math.pow(2, attempt) * 4
          : BASE_BACKOFF_MS * Math.pow(2, attempt);
      this.logger.warn(
        `[meta-whatsapp] Send to ${to} failed (status=${response.status}, code=${errorCode ?? "n/a"}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      await this.sleep(delayMs);
      return this.sendWithRetry(to, payload, originalMessage, attempt + 1);
    }

    this.logger.error(
      `[meta-whatsapp] Send to ${to} failed permanently: status=${response.status} code=${errorCode ?? "n/a"} message=${errorBody.error?.message ?? "unknown"}`
    );
    throw new Error(
      `WhatsApp Cloud API send failed: ${errorBody.error?.message ?? response.statusText} (code=${errorCode ?? "n/a"})`
    );
  }

  private toGraphPayload(to: string, message: BotMessage): Record<string, unknown> {
    const base = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
    };

    switch (message.kind) {
      case "text":
        return {
          ...base,
          type: "text",
          text: { preview_url: false, body: message.text },
        };

      case "list":
        return {
          ...base,
          type: "interactive",
          interactive: {
            type: "list",
            ...(message.header ? { header: { type: "text", text: message.header } } : {}),
            body: { text: message.body },
            action: {
              button: "Select",
              sections: [
                {
                  rows: message.rows.map((row) => ({
                    id: row.id,
                    title: row.title,
                    ...(row.description ? { description: row.description } : {}),
                  })),
                },
              ],
            },
          },
        };

      case "buttons":
        return {
          ...base,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: message.body },
            action: {
              buttons: message.buttons.map((button) => ({
                type: "reply",
                reply: { id: button.id, title: button.title },
              })),
            },
          },
        };

      case "template":
        return {
          ...base,
          type: "template",
          template: {
            name: message.name,
            language: { code: message.languageCode },
            ...(message.components && message.components.length > 0 ? { components: message.components } : {}),
          },
        };

      default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unsupported BotMessage kind: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
