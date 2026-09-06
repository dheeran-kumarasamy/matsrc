import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { WhatsAppEngineConfigService } from "./whatsapp-engine-config.service";

export type SendTemplateAlertResult = {
  status: "sent" | "failed" | "queued";
  logId: string;
  metaMessageId?: string;
  errorDetails?: string;
  mode: string;
};

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
 * WhatsappNotificationService — the low-level Meta Cloud API transport for
 * the Notification Engine (spec Phase 5/6). This is the ONLY place in the
 * new engine that ever calls `fetch(graph.facebook.com)` or reads
 * `WHATSAPP_ACCESS_TOKEN` — everything upstream (NotificationEngineService,
 * NotificationPolicyService, WhatsAppEngineChannel) is Meta-agnostic.
 *
 * Never throws to callers — every failure path (missing config, Meta 4xx/5xx,
 * network error) is captured in the returned result and persisted to
 * `WhatsAppMessageLog.errorDetails`. Access tokens are NEVER logged or
 * persisted anywhere.
 *
 * WHATSAPP_MODE (see WhatsAppEngineConfigService):
 *  - "live": calls Meta for real.
 *  - "dry-run": never calls Meta. Creates the log row and simulates
 *    queued -> sent with a clearly-identifiable mock message id
 *    (`mock-wa-<logId>`), so the whole pipeline (policy -> template -> log)
 *    is fully testable before Meta approves the "Buildohub" Display Name.
 *  - "off": does not send and does not create a misleading "sent" row —
 *    the log row is created with status "failed" and errorDetails
 *    "DISABLED_BY_CHANNEL".
 *
 * Buttons: this service deliberately sends ONLY a `body` component (the
 * text parameters) and never constructs a `button`/header component. A
 * Meta Utility template's Quick-Reply/Call-to-Action button (e.g.
 * "supplier_rfq_reminder"'s static "Submit Quote" button, or
 * "supplier_quote_alert"'s "Review RFQ" button) is rendered automatically
 * by WhatsApp from the approved template definition itself — it requires
 * no extra `components` entry unless the button is configured in Meta as a
 * *dynamic* URL button (which would need a `type: "button"` component with
 * the per-recipient URL suffix). None of the currently-mapped templates
 * (including "supplier_rfq_reminder") are configured with a dynamic URL
 * button in Meta today, so this stays body-parameters-only. This is also
 * exactly why "customer_order_status" (Order Status template type, no
 * button at all) sends correctly with zero special-casing: the absence of
 * a button component here works identically whether or not the approved
 * template itself has a button.
 */
@Injectable()
export class WhatsappNotificationService {
  private readonly logger = new Logger(WhatsappNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WhatsAppEngineConfigService
  ) {}

  async sendTemplateAlert(phone: string, templateName: string, parameters: string[]): Promise<SendTemplateAlertResult> {
    const mode = this.config.getMode();

    const log = await this.prisma.whatsAppMessageLog.create({
      data: {
        phoneNumber: phone,
        templateName,
        direction: "outbound",
        status: "queued",
        parameters,
        mode,
      },
    });

    if (mode === "off") {
      return this.finalizeOff(log.id, mode);
    }

    if (mode === "dry-run") {
      return this.finalizeDryRun(log.id, templateName, phone, mode);
    }

    return this.sendLive(log.id, phone, templateName, parameters, mode);
  }

  private async finalizeOff(logId: string, mode: string): Promise<SendTemplateAlertResult> {
    const updated = await this.prisma.whatsAppMessageLog.update({
      where: { id: logId },
      data: { status: "failed", errorDetails: "DISABLED_BY_CHANNEL" },
    });
    return { status: "failed", logId: updated.id, errorDetails: "DISABLED_BY_CHANNEL", mode };
  }

  private async finalizeDryRun(logId: string, templateName: string, phone: string, mode: string): Promise<SendTemplateAlertResult> {
    const mockMessageId = `mock-wa-${logId}`;
    const updated = await this.prisma.whatsAppMessageLog.update({
      where: { id: logId },
      data: { status: "sent", metaMessageId: mockMessageId },
    });
    this.logger.log(
      `[dry-run] Simulated WhatsApp send template=${templateName} to=${this.maskPhone(phone)} mockMessageId=${mockMessageId}`
    );
    return { status: "sent", logId: updated.id, metaMessageId: mockMessageId, mode };
  }

  private async sendLive(
    logId: string,
    phone: string,
    templateName: string,
    parameters: string[],
    mode: string
  ): Promise<SendTemplateAlertResult> {
    try {
      const phoneNumberId = this.config.getPhoneNumberId();
      const accessToken = this.config.getAccessToken();
      if (!phoneNumberId || !accessToken) {
        const errorDetails = "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not configured";
        await this.prisma.whatsAppMessageLog.update({ where: { id: logId }, data: { status: "failed", errorDetails } });
        return { status: "failed", logId, errorDetails, mode };
      }

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "template",
        template: {
          name: templateName,
          language: { code: this.config.getTemplateLanguage() },
          ...(parameters.length > 0
            ? { components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] }
            : {}),
        },
      };

      const response = await fetch(this.config.getEndpoint(), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const body = (await response.json()) as { messages?: Array<{ id: string }> };
        const metaMessageId = body.messages?.[0]?.id;
        const updated = await this.prisma.whatsAppMessageLog.update({
          where: { id: logId },
          data: { status: "sent", metaMessageId },
        });
        return { status: "sent", logId: updated.id, metaMessageId: metaMessageId ?? undefined, mode };
      }

      const errorBody = (await response.json().catch(() => ({}))) as MetaGraphErrorBody;
      const errorDetails = this.formatMetaError(response.status, errorBody);
      this.logger.error(`[meta-whatsapp] Send to ${this.maskPhone(phone)} failed: ${errorDetails}`);

      await this.prisma.whatsAppMessageLog.update({ where: { id: logId }, data: { status: "failed", errorDetails } });
      return { status: "failed", logId, errorDetails, mode };
    } catch (error) {
      const errorDetails = error instanceof Error ? error.message : "Unknown WhatsApp send error";
      this.logger.error(`[meta-whatsapp] Network error sending to ${this.maskPhone(phone)}: ${errorDetails}`);
      await this.prisma.whatsAppMessageLog
        .update({ where: { id: logId }, data: { status: "failed", errorDetails } })
        .catch(() => undefined);
      return { status: "failed", logId, errorDetails, mode };
    }
  }

  private formatMetaError(status: number, body: MetaGraphErrorBody): string {
    const err = body.error;
    if (!err) return `Meta Cloud API error (HTTP ${status})`;
    return `Meta Cloud API error (HTTP ${status}, code=${err.code ?? "n/a"}, subcode=${err.error_subcode ?? "n/a"}): ${err.message ?? "unknown"}`;
  }

  /** Never log a full phone number in free-text log lines. */
  private maskPhone(phone: string): string {
    if (phone.length <= 4) return "***";
    return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
  }
}
