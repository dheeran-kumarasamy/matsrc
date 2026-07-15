/**
 * Provider-agnostic abstraction for sending outbound WhatsApp business alert messages
 * (watchlist price hits, order-status updates, RFQ quote-received notices, etc).
 *
 * This interface is the ONLY thing business-logic call sites (order-status hook,
 * watchlist-alert hook, RFQ-quote hook — see `whatsapp-alert.service.ts`) are allowed to
 * depend on. Swapping providers (e.g. Twilio -> Meta WhatsApp Cloud API) means adding a
 * new class that implements this interface and flipping the `WHATSAPP_PROVIDER` config
 * value — call sites never change.
 *
 * `templateKey` is a LOGICAL alert type, not a raw provider template ID. The mapping
 * from logical key to the actual provider-specific template identifier (e.g. a Twilio
 * Content Template SID, or later a Meta template name) lives entirely in
 * `whatsapp-alert-config.service.ts`.
 */
export type WhatsAppAlertTemplateKey =
  | "watchlist_price_hit"
  | "order_status_update"
  | "rfq_quote_received";

export type WhatsAppSendTemplateParams = Record<string, string>;

export type WhatsAppSendTemplateResult = {
  success: boolean;
  providerMessageId?: string;
  error?: string;
};

export const WHATSAPP_ALERT_PROVIDER = Symbol("WHATSAPP_ALERT_PROVIDER");

export interface WhatsAppProvider {
  /**
   * Sends a pre-approved WhatsApp Content/Business template message to `to` (E.164 or
   * bare phone string — providers are responsible for their own formatting needs).
   *
   * Must never throw — all failure modes (invalid number, unapproved template,
   * transient 5xx, rate limiting, etc) are represented in the returned result object so
   * callers can log-and-continue without a try/catch around every call site.
   */
  sendTemplateMessage(
    to: string,
    templateKey: WhatsAppAlertTemplateKey,
    params: WhatsAppSendTemplateParams
  ): Promise<WhatsAppSendTemplateResult>;
}
