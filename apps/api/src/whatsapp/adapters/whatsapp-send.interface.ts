import { BotMessage } from "../whatsapp.types";

export const WHATSAPP_SEND_PROVIDER = Symbol("WHATSAPP_SEND_PROVIDER");

export type WhatsAppSendResult = {
  externalId: string;
  provider: string;
};

/**
 * Outbound send abstraction, mirroring the existing `NotificationProvider` pattern in
 * `src/notifications/adapters`. Swap `MockWhatsAppSendAdapter` for a real WhatsApp Cloud
 * API / BSP (Interakt/WATI/Gupshup) adapter when credentials are available — no other
 * code in this module needs to change.
 */
export interface WhatsAppSendAdapter {
  send(to: string, message: BotMessage): Promise<WhatsAppSendResult>;
}
