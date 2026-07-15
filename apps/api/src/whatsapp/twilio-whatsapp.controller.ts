import { createHmac, timingSafeEqual } from "crypto";
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { WhatsAppRouterService } from "./whatsapp-router.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppAuditHelper } from "./whatsapp-audit.helper";
import { BotMessage } from "./whatsapp.types";

/**
 * Twilio's inbound WhatsApp webhook payload shape — sent as
 * `application/x-www-form-urlencoded`, parsed by Nest's default body parser into a plain
 * object (unlike Meta's nested JSON `entry[].changes[].value.messages[]` shape handled by
 * `WhatsAppController`). See:
 * https://www.twilio.com/docs/messaging/guides/webhook-request
 */
type TwilioInboundWebhookBody = {
  MessageSid?: string;
  SmsMessageSid?: string;
  From?: string; // e.g. "whatsapp:+919876543210"
  To?: string;
  Body?: string;
  WaId?: string; // bare number, no "whatsapp:" prefix, e.g. "919876543210"
  ButtonText?: string; // set when the sender tapped a Quick Reply button (Content Template)
  [key: string]: unknown;
};

/**
 * Twilio's delivery-status callback payload shape (configured as the Messaging
 * Service's/number's "Status Callback URL", or passed as `statusCallback` per-message).
 * Distinct endpoint from the inbound-message webhook above, since Twilio POSTs these to
 * whatever URL is configured independently of the inbound webhook URL.
 */
type TwilioStatusCallbackBody = {
  MessageSid?: string;
  MessageStatus?: string; // queued|sent|delivered|read|failed|undelivered
  To?: string;
  ErrorCode?: string;
  [key: string]: unknown;
};

/**
 * Twilio counterpart to `WhatsAppController`, for the Supplier bot when
 * `WHATSAPP_ADAPTER=twilio`. Kept as a SEPARATE controller/route (rather than teaching
 * `WhatsAppController.receive()` to detect a second payload shape) since Twilio's
 * form-encoded webhook body is structurally unrelated to Meta's nested JSON shape —
 * this avoids an ever-growing shape-detection branch in one method.
 *
 * Both controllers converge on the same `WhatsAppRouterService.handleInboundMessage()`
 * and `WhatsAppSessionService.withIdempotency()` — no session/flow/auth code is
 * duplicated, only the transport-level parsing differs.
 */
@Controller("whatsapp/twilio-webhook")
export class TwilioWhatsAppController {
  constructor(
    private readonly router: WhatsAppRouterService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly auditHelper: WhatsAppAuditHelper
  ) {}

  /** Inbound message webhook — configured as the number/Messaging Service's "A MESSAGE COMES IN" webhook. */
  @Post("messages")
  @HttpCode(HttpStatus.OK)
  async receiveMessage(
    @Body() body: TwilioInboundWebhookBody,
    @Headers("x-twilio-signature") signatureHeader: string | undefined,
    @Res() res: Response
  ) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    // Twilio signs the request using the full callback URL + sorted POST params — since
    // computing that here would require knowing our own externally-visible URL (which
    // varies between local ngrok/staging/production), and this repo's Meta webhook only
    // enforces signature checks "when a secret is configured" as well (see
    // `WhatsAppController.isValidSignature`), we mirror that same permissive-until-
    // configured pattern via `TWILIO_WEBHOOK_VALIDATE_SIGNATURE=true` + the public URL.
    if (process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE === "true") {
      if (!authToken || !signatureHeader) {
        res.status(HttpStatus.UNAUTHORIZED).json({ ok: false, error: "Missing Twilio signature or auth token" });
        return;
      }
      // NOTE: full canonical validation requires the exact public webhook URL this
      // request was sent to (see TWILIO_WEBHOOK_PUBLIC_URL) — validated in
      // `isValidTwilioSignature`.
      if (!this.isValidTwilioSignature(body, signatureHeader, authToken)) {
        res.status(HttpStatus.UNAUTHORIZED).json({ ok: false, error: "Invalid Twilio webhook signature" });
        return;
      }
    }

    const phone = this.normalizePhone(body.From ?? body.WaId);
    if (!phone) {
      res.status(HttpStatus.OK).json({ ok: false, error: "Missing sender phone number" });
      return;
    }

    const text = body.ButtonText ?? body.Body ?? "";
    const messageId = body.MessageSid ?? body.SmsMessageSid;

    const reply: BotMessage = messageId
      ? await this.sessionService.withIdempotency(`twilio-webhook-message:${messageId}`, () =>
          this.router.handleInboundMessage(phone, text)
        )
      : await this.router.handleInboundMessage(phone, text);

    // Twilio's webhook contract accepts either an empty 200 or TwiML — we already send
    // the reply out-of-band via the `TwilioSupplierSendAdapter` (through
    // `WHATSAPP_SEND_PROVIDER`) at the point each flow calls `send()`, so no TwiML body
    // is required here; a plain 200 JSON ack is sufficient (mirrors `WhatsAppController`).
    res.status(HttpStatus.OK).json({ ok: true, reply });
  }

  /** Delivery-status callback webhook — configured as the "Status Callback URL". */
  @Post("status")
  @HttpCode(HttpStatus.OK)
  async receiveStatus(@Body() body: TwilioStatusCallbackBody, @Res() res: Response) {
    if (body.MessageSid && body.MessageStatus) {
      try {
        await this.auditHelper.recordDeliveryStatus({
          actorId: "system",
          messageId: body.MessageSid,
          status: body.MessageStatus,
          recipientPhone: this.normalizePhone(body.To) ?? body.To ?? "",
          errors: body.ErrorCode ?? null,
        });
      } catch {
        // Best-effort audit trail — never fail the webhook response over a logging issue.
      }
    }

    res.status(HttpStatus.OK).json({ ok: true });
  }

  private normalizePhone(raw: string | undefined): string {
    if (!raw) return "";
    return raw.replace(/^whatsapp:/, "").trim();
  }

  /**
   * Twilio's X-Twilio-Signature validation: HMAC-SHA1 of (full webhook URL + sorted POST
   * param key/value pairs concatenated), base64-encoded, keyed by the Auth Token. Requires
   * `TWILIO_WEBHOOK_PUBLIC_URL` (the exact URL Twilio is configured to call) to be set.
   */
  private isValidTwilioSignature(body: TwilioInboundWebhookBody, signatureHeader: string, authToken: string): boolean {
    const publicUrl = process.env.TWILIO_WEBHOOK_PUBLIC_URL;
    if (!publicUrl) {
      return false;
    }

    const sortedKeys = Object.keys(body).sort();
    const data = sortedKeys.reduce((acc, key) => acc + key + String(body[key] ?? ""), publicUrl);

    const expectedSignature = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");

    const expectedBuffer = Buffer.from(expectedSignature, "utf-8");
    const providedBuffer = Buffer.from(signatureHeader, "utf-8");

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
}
