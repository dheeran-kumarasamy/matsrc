import { createHmac, timingSafeEqual } from "crypto";
import { Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, RawBodyRequest, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { WhatsAppRouterService } from "./whatsapp-router.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppAuditHelper } from "./whatsapp-audit.helper";

type MetaWebhookMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    list_reply?: { id: string; title: string };
    button_reply?: { id: string; title: string };
  };
};

type MetaWebhookStatus = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: unknown;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product?: string;
        metadata?: { display_phone_number: string; phone_number_id: string };
        messages?: MetaWebhookMessage[];
        statuses?: MetaWebhookStatus[];
      };
    }>;
  }>;
  // Simplified mock-friendly shape, retained for local/dev testing without a real
  // Meta webhook payload (see `MockWhatsAppSendAdapter`-based dev flow).
  phone?: string;
  from?: string;
  text?: string;
  message?: string;
};

/**
 * Webhook endpoints for the Supplier WhatsApp bot.
 *
 * Supports both:
 *  - The real WhatsApp Cloud API webhook shape (`entry[].changes[].value.messages[]` /
 *    `.statuses[]`), verified via `X-Hub-Signature-256` when `WHATSAPP_APP_SECRET` is
 *    configured (i.e. in production / `WHATSAPP_ADAPTER=meta`).
 *  - A simplified `{phone, text}` mock shape for local/dev/test use with
 *    `MockWhatsAppSendAdapter`, where no signature is present/required.
 */
@Controller("whatsapp/webhook")
export class WhatsAppController {
  constructor(
    private readonly router: WhatsAppRouterService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly auditHelper: WhatsAppAuditHelper
  ) {}

  /** WhatsApp Cloud API verification handshake. */
  @Get()
  verify(
    @Query("hub.mode") mode: string | undefined,
    @Query("hub.verify_token") token: string | undefined,
    @Query("hub.challenge") challenge: string | undefined,
    @Res() res: Response
  ) {
    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "matsrc-dev-verify-token";
    if (mode === "subscribe" && token === expectedToken) {
      res.status(HttpStatus.OK).send(challenge ?? "");
      return;
    }
    res.status(HttpStatus.FORBIDDEN).send("verification_failed");
  }

  /** Inbound message / delivery-status webhook. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signatureHeader: string | undefined,
    @Res() res: Response
  ) {
    const body = req.body as MetaWebhookPayload;
    const appSecret = process.env.WHATSAPP_APP_SECRET;

    // Only enforce signature verification when an app secret is configured — this keeps
    // the mock/dev/test flow (no signature header, no secret configured) working
    // unchanged, while requiring valid signatures whenever a real secret is present.
    if (appSecret) {
      if (!this.isValidSignature(req.rawBody, signatureHeader, appSecret)) {
        res.status(HttpStatus.UNAUTHORIZED).json({ ok: false, error: "Invalid webhook signature" });
        return;
      }
    }

    const statuses = this.extractStatuses(body);
    if (statuses.length > 0) {
      await this.handleDeliveryStatuses(statuses);
    }

    const inbound = this.extractInboundMessage(body);
    if (!inbound) {
      // Statuses-only payload (or nothing actionable) — acknowledge with 200 so Meta
      // doesn't retry, per its webhook contract.
      res.status(HttpStatus.OK).json({ ok: true });
      return;
    }

    const { phone, text, messageId } = inbound;

    if (!phone) {
      res.status(HttpStatus.OK).json({ ok: false, error: "Missing sender phone number" });
      return;
    }

    // Dedup inbound webhook retries by Meta's `messages[].id` (a separate concern from
    // the per-mutating-action idempotency already implemented in
    // `WhatsAppSessionService.withIdempotency`, which is keyed per action, not per
    // inbound delivery).
    const reply = messageId
      ? await this.sessionService.withIdempotency(`webhook-message:${messageId}`, () =>
          this.router.handleInboundMessage(phone, text)
        )
      : await this.router.handleInboundMessage(phone, text);

    res.status(HttpStatus.OK).json({ ok: true, reply });
  }

  private isValidSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!rawBody || !signatureHeader || !signatureHeader.startsWith("sha256=")) {
      return false;
    }

    const expectedSignature = createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const providedSignature = signatureHeader.slice("sha256=".length);

    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const providedBuffer = Buffer.from(providedSignature, "hex");

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  private extractStatuses(body: MetaWebhookPayload): MetaWebhookStatus[] {
    const statuses: MetaWebhookStatus[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.value?.statuses) {
          statuses.push(...change.value.statuses);
        }
      }
    }
    return statuses;
  }

  private async handleDeliveryStatuses(statuses: MetaWebhookStatus[]): Promise<void> {
    for (const status of statuses) {
      try {
        await this.auditHelper.recordDeliveryStatus({
          actorId: "system",
          messageId: status.id,
          status: status.status,
          recipientPhone: status.recipient_id,
          timestamp: status.timestamp,
          errors: status.errors,
        });
      } catch {
        // Best-effort audit trail — never fail the webhook response over a logging issue.
      }
    }
  }

  private extractInboundMessage(body: MetaWebhookPayload): { phone: string; text: string; messageId?: string } | null {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const message = change.value?.messages?.[0];
        if (message) {
          const text =
            message.text?.body ??
            message.interactive?.list_reply?.id ??
            message.interactive?.button_reply?.id ??
            "";
          return { phone: message.from, text, messageId: message.id };
        }
      }
    }

    // Fallback: simplified mock-friendly shape used in local/dev/test.
    const phone = body.phone ?? body.from;
    const text = body.text ?? body.message ?? "";
    if (phone) {
      return { phone, text };
    }

    return null;
  }
}
