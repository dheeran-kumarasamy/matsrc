export type WhatsAppSendPayload = {
  to: string;
  title: string;
  body: string;
};

export type WhatsAppSendResult = {
  externalId: string;
  provider: string;
};

export interface NotificationProvider {
  sendWhatsAppMessage(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult>;
}