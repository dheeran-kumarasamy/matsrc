export type WhatsAppSendPayload = {
  to: string;
  title: string;
  body: string;
  idempotencyKey?: string;
  context?: Record<string, unknown>;
};

export type WhatsAppSendResult = {
  externalId: string;
  provider: string;
};

export interface NotificationProvider {
  sendWhatsAppMessage(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult>;
}