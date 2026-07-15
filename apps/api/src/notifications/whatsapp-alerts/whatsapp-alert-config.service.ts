import { Injectable } from "@nestjs/common";
import { WhatsAppAlertTemplateKey } from "./whatsapp-alert-provider.interface";

/**
 * Central place for all WhatsApp-alert-related env/config reads, following the same
 * plain-`process.env` + small-getter-service pattern already used elsewhere in this repo
 * (see `AggregationConfigService`, `MetaCloudApiSendAdapter`) rather than introducing a
 * new validation framework.
 *
 * IMPORTANT: this is deliberately kept separate from the existing `WHATSAPP_*` env vars
 * used by `apps/api/src/whatsapp/*` (the Supplier WhatsApp bot / Meta Cloud API direct
 * integration) — that is a different feature with a different provider abstraction. This
 * config only concerns outbound business alerts (watchlist/order-status/RFQ) sent
 * through `WhatsAppProvider`.
 */
@Injectable()
export class WhatsAppAlertConfigService {
  /** Master kill-switch — when false, no WhatsApp alert send is ever attempted. */
  isEnabled(): boolean {
    return process.env.WHATSAPP_ENABLED === "true";
  }

  /** Which `WhatsAppProvider` implementation to bind — "twilio" today, "meta" later. */
  getProvider(): string {
    return process.env.WHATSAPP_PROVIDER || "twilio";
  }

  getTwilioAccountSid(): string | undefined {
    return process.env.TWILIO_ACCOUNT_SID;
  }

  getTwilioAuthToken(): string | undefined {
    return process.env.TWILIO_AUTH_TOKEN;
  }

  /** Sender identity: either a WhatsApp-enabled Twilio number OR a Messaging Service SID. */
  getTwilioWhatsAppNumber(): string | undefined {
    return process.env.TWILIO_WHATSAPP_NUMBER;
  }

  getTwilioMessagingServiceSid(): string | undefined {
    return process.env.TWILIO_MESSAGING_SERVICE_SID;
  }

  /** Shared secret used to validate inbound Twilio status-callback webhook requests. */
  getTwilioStatusCallbackAuthToken(): string | undefined {
    return process.env.TWILIO_STATUS_CALLBACK_AUTH_TOKEN;
  }

  /**
   * Maps a logical template key to the actual provider-specific Content Template SID.
   * This is the ONLY place the swap-to-Meta-later work needs to touch besides adding the
   * new provider class — call sites always pass the logical key, never a raw SID.
   */
  getTwilioContentSid(templateKey: WhatsAppAlertTemplateKey): string | undefined {
    switch (templateKey) {
      case "watchlist_price_hit":
        return process.env.TWILIO_CONTENT_SID_WATCHLIST_PRICE_HIT;
      case "order_status_update":
        return process.env.TWILIO_CONTENT_SID_ORDER_STATUS_UPDATE;
      case "rfq_quote_received":
        return process.env.TWILIO_CONTENT_SID_RFQ_QUOTE_RECEIVED;
      default: {
        const exhaustiveCheck: never = templateKey;
        return exhaustiveCheck;
      }
    }
  }
}
