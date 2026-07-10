import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { BotMessage } from "../whatsapp.types";
import { WhatsAppSendAdapter, WhatsAppSendResult } from "./whatsapp-send.interface";

/**
 * No-op WhatsApp send adapter — logs the structured message it would have sent via the
 * WhatsApp Business API (Cloud API or a BSP). This lets the whole bot module run and be
 * tested without live BSP credentials; replace with a real HTTP client implementation
 * later behind the same `WhatsAppSendAdapter` interface.
 */
@Injectable()
export class MockWhatsAppSendAdapter implements WhatsAppSendAdapter {
  private readonly logger = new Logger(MockWhatsAppSendAdapter.name);

  async send(to: string, message: BotMessage): Promise<WhatsAppSendResult> {
    this.logger.log(`[mock-whatsapp-send] -> ${to}: ${JSON.stringify(message)}`);
    return {
      externalId: randomUUID(),
      provider: "mock-whatsapp",
    };
  }
}
