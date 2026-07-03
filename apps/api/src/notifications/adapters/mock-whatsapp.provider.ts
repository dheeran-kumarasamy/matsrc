import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import { NotificationProvider, WhatsAppSendPayload, WhatsAppSendResult } from "./notification-provider.interface";

@Injectable()
export class MockWhatsAppProvider implements NotificationProvider {
  async sendWhatsAppMessage(_payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
    return {
      externalId: `mock-wa-${randomUUID()}`,
      provider: "mock-whatsapp",
    };
  }
}